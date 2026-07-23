# Fruit Jam prototype

Written in CircuitPython for the [Adafruit Fruit Jam](https://learn.adafruit.com/adafruit-fruit-jam) RP2350-based mini computer.

Main firmware is in `code.py` and handles:
 - Hardware buttons
 - NeoPixels
 - USB host for keyboard
 - USB HID for passthrough
 - Wifi for network time & attestation

Unique hardware device ID is formed from board ID (`adafruit_fruit_jam`) and CPU serial number (`microcontroller.cpu.uid`).

## Fingerprint sensor

Uses the [Adafruit Basic Fingerprint Sensor (#4690)](https://www.adafruit.com/product/4690) on UART1:

| Sensor wire | Fruit Jam pin |
|---|---|
| VCC (red) | 3.3V |
| GND (black) | GND |
| TX (green) | D9/GPIO9 (RX) |
| RX (white) | D8/GPIO8 (TX) |

Touch the sensor to start recording (a burst of find-mode captures flashes
its LED as the cue), touch it again to verify your finger and send. While signing, the device types
`encrypting` over USB HID, then backspaces it and types the share URL.
Enroll fingers once from Thonny with `enroll.py`.

## Dependencies

As with any CircuitPython, secrets are in `settings.toml` and include the wifi credentials and the Ed25519 keypair.

From the CircuitPython bundle: [`adafruit_fingerprint`](https://github.com/adafruit/Adafruit_CircuitPython_Fingerprint) (copy `adafruit_fingerprint.mpy` to `lib/`), plus the HID/ESP32SPI/requests/NTP libraries already in use.

Makes use of [`ed25519.py`](https://github.com/pyca/ed25519) which is an all-in-one drop-in ideal for this environment. It is not cryptographically secure since it is slower than alternatives and subject to side-channel attacks, but is good enough for a prototype. This library is altered only to use [`adafruit_hashlib`](https://github.com/adafruit/Adafruit_CircuitPython_hashlib) instead of the default CircuitPython `hashlib` to access the necessary SHA-512 support.
