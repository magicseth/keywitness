/**
 * KeyWitness Teensy — attesting keyboard passthrough (no-WiFi stopgap).
 *
 * Builds on Justin's KeyboardForward.ino (same pins, same passthrough).
 *
 *   [keyboard] --USB--> [Teensy host port]     [Teensy micro-USB] --> [computer]
 *                            |                        ^
 *                       record + buffer        types a curl command
 *
 * Flow:
 *   - Keys always pass through to the computer.
 *   - Press button: start recording (blue LED on).
 *   - Press again:  sign what was typed (Ed25519, v1 attestation) and type out
 *                   a ready-to-run curl command that POSTs it to
 *                   https://www.keywitness.io/api/attestations and prints the
 *                   proof URL. Focus a terminal, press Enter to run it.
 *                   Green = signed & typed.
 *   - Hold >2s while recording: discard the buffer without attesting (red).
 *
 * This is a temporary bridge-free path until a WiFi board (e.g. Teensy +
 * Adafruit AirLift) does the POST on-device. Then this step becomes a direct
 * WiFiSSLClient POST and the curl typeout goes away.
 *
 * Arduino IDE setup:
 *   - Board: Teensy 3.6 or 4.x, USB Type: "Serial + Keyboard + Mouse + Joystick"
 *   - Libraries: USBHost_t36 (bundled with Teensyduino),
 *                Crypto by Rhys Weatherley (Ed25519, SHA256),
 *                Entropy (bundled with Teensyduino)
 *
 * First boot generates an Ed25519 keypair (seed stored in EEPROM) and prints
 * the deviceId + public key on the USB serial monitor — register that key /
 * claim a username at keywitness.io.
 */

#include "USBHost_t36.h"
#include <EEPROM.h>
#include <Entropy.h>
#include <Crypto.h>
#include <Ed25519.h>
#include <SHA256.h>
#include <time.h>

#include "attestation_v1.h"

/* --------------------------------------------------------------------- */
/* Pins (Justin's wiring)                                                 */
/* --------------------------------------------------------------------- */

const int blue   = 2;
const int red    = 3;
const int yellow = 23;
const int green  = 22;

const int buttonGround = 30;
const int buttonActive = 32;

/* --------------------------------------------------------------------- */
/* USB host                                                               */
/* --------------------------------------------------------------------- */

USBHost myusb;
USBHub hub1(myusb);
KeyboardController keyboard1(myusb);
USBHIDParser hid1(myusb);

/* --------------------------------------------------------------------- */
/* State                                                                  */
/* --------------------------------------------------------------------- */

#define KW_CLEARTEXT_MAX   4096
#define KW_RECORD_MAX      16384
#define KW_JSON_SCRATCH    (KW_CLEARTEXT_MAX * 6 + 1024)
#define KW_B64_MAX         ((KW_JSON_SCRATCH / 3 + 1) * 4 + 8)

static char cleartext[KW_CLEARTEXT_MAX];
static size_t cleartextLen = 0;

/* Keystroke timing record, Justin's format: "<key>,<ms-since-last>|..." */
static char record[KW_RECORD_MAX];
static size_t recordLen = 0;

static char jsonScratch[KW_JSON_SCRATCH];
static char blockB64[KW_B64_MAX];

static bool recording = false;
static bool attesting = false;
static unsigned long idle = 0;

/* Ed25519 key material */
static uint8_t privKey[32];
static uint8_t pubKey[32];
static char deviceId[32];

/* EEPROM key store */
struct KeyStore {
    uint32_t magic;
    uint8_t seed[32];
};
const uint32_t KW_EEPROM_MAGIC = 0x4B573101; /* "KW1" + version 1 */

/* --------------------------------------------------------------------- */
/* LEDs                                                                   */
/* --------------------------------------------------------------------- */

void ledsOff()
{
    digitalWrite(blue, 0);
    digitalWrite(red, 0);
    digitalWrite(yellow, 0);
    digitalWrite(green, 0);
}

void cycle()
{
    const int wait = 100;
    int pins[] = { blue, red, green, yellow };
    for (int i = 0; i < 4; i++) {
        digitalWrite(pins[i], 1);
        delay(wait);
        digitalWrite(pins[i], 0);
    }
}

void blinkPin(int pin, int times)
{
    for (int i = 0; i < times; i++) {
        digitalWrite(pin, 1);
        delay(150);
        digitalWrite(pin, 0);
        delay(150);
    }
}

/* --------------------------------------------------------------------- */
/* Key material                                                           */
/* --------------------------------------------------------------------- */

void loadOrGenerateKeys()
{
    KeyStore store;
    EEPROM.get(0, store);

    if (store.magic != KW_EEPROM_MAGIC) {
        Serial.println("No key found - generating Ed25519 keypair...");
        Entropy.Initialize();
        for (int i = 0; i < 8; i++) {
            uint32_t r = Entropy.random();
            memcpy(&store.seed[i * 4], &r, 4);
        }
        store.magic = KW_EEPROM_MAGIC;
        EEPROM.put(0, store);
    }

    memcpy(privKey, store.seed, 32);
    Ed25519::derivePublicKey(pubKey, privKey);

    /* deviceId from the chip's unique ID.
     * Teensy 3.5/3.6 (Kinetis K64/K66): SIM_UIDMH/SIM_UIDML/SIM_UIDL.
     * Teensy 4.x (i.MX RT1062):          HW_OCOTP_CFG0/CFG1. */
#if defined(__IMXRT1062__)
    snprintf(deviceId, sizeof(deviceId), "TEENSY4-%08lX%08lX",
             (unsigned long)HW_OCOTP_CFG0, (unsigned long)HW_OCOTP_CFG1);
#elif defined(__MK66FX1M0__) || defined(__MK64FX512__)
    snprintf(deviceId, sizeof(deviceId), "TEENSY36-%08lX%08lX",
             (unsigned long)SIM_UIDMH, (unsigned long)SIM_UIDL);
#else
    snprintf(deviceId, sizeof(deviceId), "TEENSY-%08lX", (unsigned long)SIM_UIDL);
#endif

    char pubB64[48];
    kw_base64url_encode(pubKey, 32, pubB64, sizeof(pubB64));
    Serial.print("deviceId:  ");
    Serial.println(deviceId);
    Serial.print("publicKey: ");
    Serial.println(pubB64);
}

/* --------------------------------------------------------------------- */
/* Timestamp                                                              */
/* --------------------------------------------------------------------- */

/**
 * ISO 8601 UTC timestamp from the on-chip RTC.
 *
 * Teensyduino sets the RTC to the sketch's compile time at upload, and a coin
 * cell on VBAT keeps it running across power cycles. If the RTC looks unset we
 * fall back to a fixed recent date so the payload always has a valid string.
 * (The KeyWitness server does not currently validate the timestamp value.)
 */
static void isoTimestamp(char *out, size_t n)
{
    time_t t = (time_t)Teensy3Clock.get();
    if (t < 1700000000) t = 1751932800; /* ~2025-07-08 fallback if RTC unset */
    struct tm tmv;
    gmtime_r(&t, &tmv);
    strftime(out, n, "%Y-%m-%dT%H:%M:%S.000Z", &tmv);
}

/* --------------------------------------------------------------------- */
/* Attestation                                                            */
/* --------------------------------------------------------------------- */

void clearBuffers()
{
    cleartextLen = 0;
    cleartext[0] = '\0';
    recordLen = 0;
    record[0] = '\0';
    idle = 0;
}

void attest()
{
    if (cleartextLen == 0) {
        Serial.println("Nothing to attest");
        blinkPin(red, 2);
        return;
    }

    attesting = true;
    digitalWrite(yellow, 1);
    Serial.println("=== ATTESTING ===");

    /* 1. Hash the keystroke timing record (hex SHA-256, matching
     *    shared/attestation.ts hashKeystrokeBiometrics). */
    uint8_t digest[32];
    SHA256 sha;
    sha.update((const uint8_t *)record, recordLen);
    sha.finalize(digest, sizeof(digest));

    char bioHash[65];
    static const char hexLc[] = "0123456789abcdef";
    for (int i = 0; i < 32; i++) {
        bioHash[i * 2] = hexLc[digest[i] >> 4];
        bioHash[i * 2 + 1] = hexLc[digest[i] & 0x0F];
    }
    bioHash[64] = '\0';

    /* 2. Timestamp from the on-chip RTC. */
    char timestamp[40];
    isoTimestamp(timestamp, sizeof(timestamp));

    /* 3. Build the canonical signing payload and sign it. */
    kw_v1_fields_t fields = {
        .cleartext = cleartext,
        .device_id = deviceId,
        .timestamp = timestamp,
        .keystroke_biometrics_hash = bioHash,
    };

    size_t payloadLen = kw_build_signing_payload(&fields, jsonScratch,
                                                 sizeof(jsonScratch));
    if (payloadLen == 0) {
        Serial.println("FAILED: payload too large");
        digitalWrite(yellow, 0);
        blinkPin(red, 3);
        attesting = false;
        return;
    }

    uint8_t signature[64];
    Ed25519::sign(signature, privKey, pubKey,
                  (const uint8_t *)jsonScratch, payloadLen);

    /* 4. Full attestation block (base64url of the signed JSON). */
    if (kw_build_attestation_block_b64(&fields, signature, pubKey,
                                       jsonScratch, sizeof(jsonScratch),
                                       blockB64, sizeof(blockB64)) == 0) {
        Serial.println("FAILED: attestation too large");
        digitalWrite(yellow, 0);
        blinkPin(red, 3);
        attesting = false;
        return;
    }

    /* 5. No WiFi yet: type out a curl command that POSTs this attestation
     *    and prints the resulting proof URL. Focus a terminal first, then
     *    press Enter to run it. (Temporary until the WiFi board arrives.)
     *
     *    The PEM block's newlines are emitted as literal "\n" inside a
     *    single-quoted JSON string, so nothing executes until you hit Enter,
     *    and the server's JSON parser sees proper \n escapes.
     *    URL extraction uses sed (always present) — no jq/python needed. */
    Serial.println("Typing curl command (focus a terminal, then press Enter)");

    Keyboard.print(
        "curl -s -X POST https://www.keywitness.io/api/attestations "
        "-H 'Content-Type: application/json' "
        "-d '{\"attestation\":\"-----BEGIN KEYWITNESS ATTESTATION-----\\n");
    Keyboard.print(blockB64);
    Keyboard.print(
        "\\n-----END KEYWITNESS ATTESTATION-----\"}' "
        "| sed -n 's/.*\"url\":\"\\([^\"]*\\)\".*/\\1/p'");

    clearBuffers();
    digitalWrite(yellow, 0);
    digitalWrite(green, 1);
    delay(2000);
    digitalWrite(green, 0);

    attesting = false;
}

/* --------------------------------------------------------------------- */
/* Button: press = start recording / attest; hold >2s = discard           */
/* --------------------------------------------------------------------- */

void handleButton()
{
    if (digitalRead(buttonActive) != 0) return;
    delay(50); /* debounce */
    if (digitalRead(buttonActive) != 0) return;

    unsigned long pressedAt = millis();
    while (digitalRead(buttonActive) == 0) {
        myusb.Task();
        if (millis() - pressedAt > 2000) break;
    }
    bool held = (millis() - pressedAt) > 2000;

    if (held) {
        Serial.println("Buffer discarded");
        clearBuffers();
        recording = false;
        blinkPin(red, 1);
    } else if (!recording) {
        Serial.println("Recording started");
        clearBuffers();
        recording = true;
    } else {
        recording = false;
        attest();
    }

    /* Wait for release so one press = one action */
    while (digitalRead(buttonActive) == 0) myusb.Task();
    delay(50);
}

/* --------------------------------------------------------------------- */
/* Key handling                                                           */
/* --------------------------------------------------------------------- */

void OnPress(int key)
{
    /* Always pass through, even mid-attestation.
     * TODO: forward special keys (arrows, F-keys) via raw HID usages. */
    Keyboard.print((char)key);

    if (!recording || attesting) return;

    unsigned long last = millis() - idle;
    idle = millis();

    /* Timing record (hashed into keystrokeBiometricsHash) */
    int n = snprintf(record + recordLen, sizeof(record) - recordLen,
                     "%d,%lu|", key, last);
    if (n > 0 && recordLen + (size_t)n < sizeof(record)) recordLen += n;

    /* Cleartext reconstruction */
    if (key == 8 || key == 127) {                    /* backspace */
        if (cleartextLen > 0) cleartext[--cleartextLen] = '\0';
    } else if (key == 10 || key == 13) {             /* enter */
        if (cleartextLen + 1 < sizeof(cleartext)) {
            cleartext[cleartextLen++] = '\n';
            cleartext[cleartextLen] = '\0';
        }
    } else if (key >= 32 && key < 127) {             /* printable ASCII */
        if (cleartextLen + 1 < sizeof(cleartext)) {
            cleartext[cleartextLen++] = (char)key;
            cleartext[cleartextLen] = '\0';
        }
    }
    /* KEYD_* special keys (arrows etc., > 127) are ignored for cleartext */
}

/* --------------------------------------------------------------------- */
/* Setup / loop                                                           */
/* --------------------------------------------------------------------- */

void setup()
{
    Serial.begin(115200);

    pinMode(blue, OUTPUT);
    pinMode(red, OUTPUT);
    pinMode(yellow, OUTPUT);
    pinMode(green, OUTPUT);

    pinMode(buttonGround, OUTPUT);
    pinMode(buttonActive, INPUT_PULLUP);
    digitalWrite(buttonGround, 0);

    myusb.begin();
    keyboard1.attachPress(OnPress);

    loadOrGenerateKeys();

    Serial.println("KeyWitness Hardware Ready");
    cycle();
}

void loop()
{
    myusb.Task();

    /* Blue LED tracks recording state */
    digitalWrite(blue, recording ? 1 : 0);

    handleButton();
}
