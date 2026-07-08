/**
 * KeyWitness ESP32 Wi-Fi bridge.
 *
 * The Teensy does USB + crypto; this sketch does Wi-Fi, NTP time, and the
 * HTTPS POST to keywitness.io. Line-based protocol over UART:
 *
 *   Teensy -> ESP32:  "TIME"
 *   ESP32  -> Teensy: "TIME 2026-07-07T20:00:00.000Z"  |  "ERR <reason>"
 *
 *   Teensy -> ESP32:  "ATTEST <single-line base64url attestation JSON>"
 *   ESP32  -> Teensy: "URL https://..."                |  "ERR <reason>"
 *
 * Works on any ESP32 with the Arduino core (tested wiring assumes an
 * ESP32-C3: UART RX=20, TX=21 <-> Teensy TX1 (1) / RX1 (0), plus common GND).
 * Adjust LINK_RX/LINK_TX for other boards.
 *
 * Wi-Fi credentials live in wifi_secrets.h (gitignored). Copy
 * wifi_secrets.h.example and fill in your network.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <time.h>

#include "wifi_secrets.h"

#define API_URL "https://www.keywitness.io/api/attestations"

/* UART link to the Teensy */
#define LINK_RX 20
#define LINK_TX 21
#define LINK_BAUD 115200
HardwareSerial &link = Serial1;

/* Max incoming line: "ATTEST " + base64url attestation (photos excluded,
 * text attestations are a few KB) */
#define LINE_MAX 32768
static char line[LINE_MAX];

void setup()
{
    Serial.begin(115200);
    link.begin(LINK_BAUD, SERIAL_8N1, LINK_RX, LINK_TX);

    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(250);
        Serial.print(".");
    }
    Serial.println();
    Serial.print("Connected: ");
    Serial.println(WiFi.localIP());

    /* NTP (UTC) */
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

static bool timeSynced()
{
    return time(nullptr) > 1600000000; /* sanity: after Sep 2020 */
}

static void handleTime()
{
    if (WiFi.status() != WL_CONNECTED) {
        link.println("ERR wifi disconnected");
        return;
    }

    /* Wait briefly for NTP if it hasn't synced yet */
    unsigned long start = millis();
    while (!timeSynced() && millis() - start < 8000) delay(100);

    if (!timeSynced()) {
        link.println("ERR ntp not synced");
        return;
    }

    time_t now = time(nullptr);
    struct tm tm_utc;
    gmtime_r(&now, &tm_utc);

    char iso[40];
    /* Millisecond precision isn't available from NTP here; .000Z is fine —
     * the timestamp is part of the signed payload, not parsed for ms. */
    strftime(iso, sizeof(iso), "%Y-%m-%dT%H:%M:%S.000Z", &tm_utc);

    link.print("TIME ");
    link.println(iso);
}

static void handleAttest(const char *b64)
{
    if (WiFi.status() != WL_CONNECTED) {
        link.println("ERR wifi disconnected");
        return;
    }
    if (b64[0] == '\0') {
        link.println("ERR empty attestation");
        return;
    }

    /* JSON body with the PEM-armored block. The armor newlines must be
     * JSON-escaped (\n) inside the string. */
    String body;
    body.reserve(strlen(b64) + 128);
    body += "{\"attestation\":\"-----BEGIN KEYWITNESS ATTESTATION-----\\n";
    body += b64;
    body += "\\n-----END KEYWITNESS ATTESTATION-----\"}";

    WiFiClientSecure client;
    /* TODO: pin the keywitness.io certificate (client.setCACert) instead.
     * setInsecure() skips TLS verification — acceptable for prototyping
     * because the attestation is signed and public anyway; an MITM could
     * block but not forge it. */
    client.setInsecure();

    HTTPClient http;
    if (!http.begin(client, API_URL)) {
        link.println("ERR http begin failed");
        return;
    }
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(30000);

    int code = http.POST(body);
    String resp = http.getString();
    http.end();

    Serial.printf("POST %d: %s\n", code, resp.c_str());

    if (code != 201 && code != 200) {
        link.print("ERR http ");
        link.print(code);
        link.print(" ");
        /* Forward server error detail (single line) */
        resp.replace("\n", " ");
        link.println(resp.substring(0, 300));
        return;
    }

    /* Extract "url":"..." — URLs contain no quotes or escapes. */
    int urlKey = resp.indexOf("\"url\":\"");
    if (urlKey < 0) {
        link.println("ERR no url in response");
        return;
    }
    int urlStart = urlKey + 7;
    int urlEnd = resp.indexOf('"', urlStart);
    if (urlEnd < 0) {
        link.println("ERR malformed response");
        return;
    }

    link.print("URL ");
    link.println(resp.substring(urlStart, urlEnd));
}

static size_t lineLen = 0;

void loop()
{
    while (link.available()) {
        char c = (char)link.read();
        if (c == '\r') continue;
        if (c != '\n') {
            if (lineLen + 1 < LINE_MAX) line[lineLen++] = c;
            continue;
        }

        line[lineLen] = '\0';
        lineLen = 0;
        if (line[0] == '\0') continue;

        Serial.printf("cmd: %.60s%s\n", line, strlen(line) > 60 ? "..." : "");

        if (strcmp(line, "TIME") == 0) {
            handleTime();
        } else if (strncmp(line, "ATTEST ", 7) == 0) {
            handleAttest(line + 7);
        } else {
            link.println("ERR unknown command");
        }
    }
}
