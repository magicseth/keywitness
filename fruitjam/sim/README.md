# Fruit Jam simulator

Runs the **unmodified** `../code.py` on a desktop by stubbing every
CircuitPython module it imports (`board`, `digitalio`, `neopixel`,
`usb_hid`/`adafruit_hid`, ESP32SPI wifi, `adafruit_requests`,
`adafruit_ntp`, `adafruit_fingerprint`, `supervisor`, stdin keyboard).
HTTP posts go to the **real backend**, crypto is the real on-device
code (`ed25519.py`, `sha512.py`, `gcm.py` with a pure-Python `aesio`),
so a simulated run produces genuine attestations and share URLs.

```sh
python3 run_sim.py --settings settings.toml \
    --text "hello from the simulator" --start-slot 1 --end-slot 1
```

- `--settings` — a device-style `settings.toml` (wifi values are ignored
  beyond the SSID name; identity keys are used for real signing).
- `--start-slot` / `--end-slot` — fingerprint slot for the start/end
  touch, `0` for an unenrolled finger, or `button` to use a button press
  (no fingerprint) instead.
- `--text` — what the simulated keyboard types.

The scenario runs: touch → type → touch → waits for the share URL to be
"typed" over simulated HID, then prints everything the host computer
received. A same-slot run signs as that identity ("typed by justin …");
mismatched start/end slots fall back to the anonymous device key.
