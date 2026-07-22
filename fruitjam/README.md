# Fruit Jam prototype

Written in CircuitPython for the [Adafruit Fruit Jam](https://learn.adafruit.com/adafruit-fruit-jam) RP2350-based mini computer.

Main firmware is in `code.py` and handles:
 - Hardware buttons
 - NeoPixels
 - USB host for keyboard
 - USB HID for passthrough
 - Wifi for network time & attestation

Unique hardware device ID is formed from board ID (`adafruit_fruit_jam`) and CPU serial number (`microcontroller.cpu.uid`).

## Dependencies

As with any CircuitPython, secrets are in `settings.toml` and include the wifi credentials and the Ed25519 keypair.

Makes use of [`ed25519.py`](https://github.com/pyca/ed25519) which is an all-in-one drop-in ideal for this environment. It is not cryptographically secure since it is slower than alternatives and subject to side-channel attacks, but is good enough for a prototype. This library is altered only to use [`adafruit_hashlib`](https://github.com/adafruit/Adafruit_CircuitPython_hashlib) instead of the default CircuitPython `hashlib` to access the necessary SHA-512 support.
