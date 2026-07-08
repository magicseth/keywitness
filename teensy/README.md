# KeyWitness Teensy Hardware

A hardware attesting keyboard passthrough: a real keyboard plugs into a
Teensy 4.1's USB host port, keystrokes pass through to the computer, and on
button press the typed text is Ed25519-signed and posted to
`https://www.keywitness.io/api/attestations`. The resulting proof URL is
typed out over HID.

```
[keyboard] --USB--> [Teensy 4.1 host port]      [Teensy micro-USB] --> [computer]
                         |                             ^
                    record + buffer               types proof URL
                         |
                    Serial1 (pins 0/1, 115200)
                         |
                    [ESP32 bridge] --Wi-Fi/TLS--> keywitness.io
```

## Directory layout

| Path | What |
|---|---|
| `KeyboardForward/` | Justin's original passthrough + recording sketch |
| `KeyWitnessForward/` | Full firmware: passthrough + Ed25519 v1 attestation |
| `KeyWitnessForward/attestation_v1.{h,cpp}` | Portable (no Arduino deps) payload builder — the bytes that get signed |
| `esp32_bridge/` | ESP32 sketch: NTP time + HTTPS POST, UART-linked to the Teensy |
| `test/` | Host-side proof that device bytes pass the real server verifier |

## Why there's a test harness

The server (`web/convex/lib/verify.ts`) verifies the Ed25519 signature over
the **RFC 8785 JCS canonicalization** of the payload (alphabetically sorted
keys, `JSON.stringify` escaping). One wrong escape byte and the server
returns 400. So `attestation_v1.cpp` is pure C with no Arduino dependencies,
and the test compiles it **natively** and checks:

1. `kw_base64url_encode` byte-matches Node's `base64url`.
2. `kw_build_signing_payload` byte-matches the `canonicalize` npm package
   (the exact library the server uses) — including quotes, backslashes,
   newlines, control chars, and multibyte UTF-8.
3. A full C-built attestation block, signed with tweetnacl, **passes
   `verifyAttestationServerSide()` — the actual server code**.
4. Tampered cleartext is rejected.

Run it:

```sh
cd web && npm install          # verify.ts deps (once)
cd ../teensy/test && npm install && npm test
```

> ⚠️ Note: `shared/attestation.ts` `buildSigningPayload()` uses a fixed
> (non-alphabetical) field order that does NOT match what the server
> verifies. The server tries JCS first, then a sorted-key legacy form —
> never the fixed order. The device signs the JCS form because the server
> is what mints proof URLs. Worth reconciling in `shared/` at some point.

## Building the firmware

### Teensy 4.1 (`KeyWitnessForward/`)

- Arduino IDE + Teensyduino. Board: **Teensy 4.1**,
  USB Type: **Serial + Keyboard + Mouse + Joystick**.
- Libraries: `USBHost_t36` and `Entropy` (bundled with Teensyduino),
  **Crypto** by Rhys Weatherley (Library Manager) for Ed25519/SHA256.
- Wiring (Justin's): LEDs blue=2 red=3 yellow=23 green=22; button between
  pins 30 (driven low) and 32 (input pullup). Keyboard on the USB host
  header. ESP32 on Serial1: Teensy pin 1 (TX1) → ESP32 RX, pin 0 (RX1) ←
  ESP32 TX, common GND.

First boot generates an Ed25519 keypair (seed in EEPROM) and prints the
`deviceId` and base64url `publicKey` on the serial monitor — use that key to
claim a `typed.by` username.

**Controls:** press = start recording (blue LED). Press again = attest:
sign, upload, type the proof URL (yellow → green). Hold >2s = discard
buffer without attesting (red). Upload failure keeps the buffer so you can
retry.

### ESP32 bridge (`esp32_bridge/`)

- Any ESP32 with the Arduino core; pin defaults assume ESP32-C3
  (UART RX=20 TX=21) — adjust `LINK_RX`/`LINK_TX` for other boards.
- `cp wifi_secrets.h.example wifi_secrets.h` and fill in credentials.
  `wifi_secrets.h` is gitignored — **never commit real credentials**.

UART protocol (line-based, 115200):

```
TIME             -> TIME 2026-07-07T20:14:03.000Z | ERR <reason>
ATTEST <b64url>  -> URL https://typed.by/...      | ERR <reason>
```

The bridge wraps the base64url payload in the PEM armor and POSTs
`{"attestation": "<pem>"}`. A `201` response carries the proof URL
(`https://typed.by/<user>/<n>` if the signing key has a username, else
`https://www.keywitness.io/v/<id>`).

## Known limitations / next steps

- **Passthrough fidelity**: `Keyboard.print((char)key)` forwards printable
  text but drops modifiers/arrows/F-keys (same as the original sketch).
  Upgrade path: forward raw HID usages (`Keyboard.press(0xF000 | oemKey)`)
  plus modifier state from `keyboard1.getModifiers()`.
- **TLS**: the bridge uses `setInsecure()` (no cert validation). An MITM
  could block but not forge attestations (they're signed); pin the cert
  with `client.setCACert()` for production.
- **Key extraction**: a stock Teensy has no secure element — the seed lives
  in EEPROM. Options: Lockable Teensy 4.1 (secure mode), or an ATECC608B
  like `hardware/SPEC.md` (note: P-256, not Ed25519 — protocol change).
- **v1 = public cleartext**: the typed text is readable at the proof URL.
  v2/v3 encrypt cleartext with the key in the URL fragment; doable on-device
  later (AES-GCM via the same Crypto library).
