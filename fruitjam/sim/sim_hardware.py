"""Desktop stubs for every CircuitPython module fruitjam/code.py touches.

install(sim) registers stub modules in sys.modules so the UNMODIFIED
code.py runs on CPython. Hardware becomes SimState fields you can poke
from a scenario thread; HTTP posts go to the real backend.
"""

import sys
import time
import types
import json as _json
import urllib.request


class SimState:
    def __init__(self):
        self.buttons = {1: False, 2: False, 3: False}   # True = pressed
        self.led = False
        self.pixels = [(0, 0, 0)] * 5
        self.finger_slot = None      # not-None = finger held (slot id, 0 = unknown finger)
        self.enrolled = {1, 111}
        self.kbd_buffer = []         # chars from the "external keyboard"
        self.host_text = ""          # what the "computer" has received over HID
        self.wifi_connected = False
        self.loop_started = False
        self.stop = False
        self.log_lock = None

    # ── scenario helpers ────────────────────────────────────────────────
    def log(self, *args):
        print("[sim]", *args)

    def wait_ready(self, timeout=60):
        deadline = time.monotonic() + timeout
        while not self.loop_started:
            if time.monotonic() > deadline:
                raise RuntimeError("device never became ready")
            time.sleep(0.1)
        self.log("device ready (main loop running)")

    def touch(self, slot, hold=0.8):
        self.log(f"finger touch: slot {slot}")
        self.finger_slot = slot
        time.sleep(hold)
        self.finger_slot = None
        time.sleep(0.4)

    def type(self, text, cps=15.0):
        self.log(f"typing: {text!r}")
        for c in text:
            self.kbd_buffer.append(c)
            time.sleep(1.0 / cps)

    def press_button(self, n=1):
        self.log(f"button {n} press")
        self.buttons[n] = True
        time.sleep(0.15)
        self.buttons[n] = False
        time.sleep(0.6)

    def wait_host_contains(self, needle, timeout=120):
        deadline = time.monotonic() + timeout
        while needle not in self.host_text:
            if time.monotonic() > deadline:
                raise RuntimeError(f"timed out waiting for {needle!r} in host text")
            time.sleep(0.2)


def _mod(name):
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


def install(sim):
    # ── board ───────────────────────────────────────────────────────────
    board = _mod("board")

    class Pin:
        def __init__(self, name):
            self.name = name

        def __repr__(self):
            return f"<Pin {self.name}>"

    for name in ("LED", "BUTTON1", "BUTTON2", "BUTTON3", "NEOPIXEL",
                 "TX", "RX", "ESP_CS", "ESP_BUSY", "ESP_RESET", "D6", "D7", "D8", "D9"):
        setattr(board, name, Pin(name))
    board.board_id = "fruitjam_simulator"
    board.SPI = lambda: None

    # ── digitalio ───────────────────────────────────────────────────────
    digitalio = _mod("digitalio")

    class Direction:
        OUTPUT = "out"
        INPUT = "in"

    class Pull:
        UP = "up"
        DOWN = "down"

    class DigitalInOut:
        def __init__(self, pin):
            self._pin = pin
            self.direction = Direction.INPUT

        def switch_to_input(self, pull=None):
            self.direction = Direction.INPUT

        def switch_to_output(self, value=False):
            self.direction = Direction.OUTPUT
            self.value = value

        @property
        def value(self):
            if self._pin.name.startswith("BUTTON"):
                return not sim.buttons[int(self._pin.name[-1])]  # pull-up
            if self._pin.name == "LED":
                return sim.led
            return getattr(self, "_value", False)

        @value.setter
        def value(self, v):
            if self._pin.name == "LED":
                sim.led = v
            self._value = v

    digitalio.Direction = Direction
    digitalio.Pull = Pull
    digitalio.DigitalInOut = DigitalInOut

    # ── neopixel ────────────────────────────────────────────────────────
    neopixel = _mod("neopixel")

    class NeoPixel:
        def __init__(self, pin, n, brightness=1.0):
            self._n = n
            self.brightness = brightness

        def __len__(self):
            return self._n

        def __iter__(self):
            return iter(sim.pixels)

        def __setitem__(self, i, v):
            sim.pixels[i] = v

        def fill(self, v):
            sim.pixels = [v] * self._n

        def show(self):
            pass

    neopixel.NeoPixel = NeoPixel

    # ── usb_hid + adafruit_hid ──────────────────────────────────────────
    usb_hid = _mod("usb_hid")
    usb_hid.devices = []

    ahid = _mod("adafruit_hid")
    kbd_mod = _mod("adafruit_hid.keyboard")
    layout_mod = _mod("adafruit_hid.keyboard_layout_us")
    keycode_mod = _mod("adafruit_hid.keycode")
    ahid.keyboard = kbd_mod
    ahid.keyboard_layout_us = layout_mod
    ahid.keycode = keycode_mod

    class Keycode:
        BACKSPACE = 0x2A

    keycode_mod.Keycode = Keycode

    class Keyboard:
        def __init__(self, devices):
            pass

        def send(self, code):
            if code == Keycode.BACKSPACE and sim.host_text:
                sim.host_text = sim.host_text[:-1]

    kbd_mod.Keyboard = Keyboard

    class KeyboardLayoutUS:
        def __init__(self, kb):
            pass

        def write(self, s):
            sim.host_text += s

    layout_mod.KeyboardLayoutUS = KeyboardLayoutUS

    # ── wifi / esp32spi ────────────────────────────────────────────────
    esp_pkg = _mod("adafruit_esp32spi")
    esp_mod = _mod("adafruit_esp32spi.adafruit_esp32spi")
    esp_pkg.adafruit_esp32spi = esp_mod
    esp_mod.WL_IDLE_STATUS = 0

    class _AP:
        def __init__(self, ssid):
            self.ssid = ssid
            self.rssi = -42

    class ESP_SPIcontrol:
        def __init__(self, spi, cs, ready, reset):
            self.firmware_version = "simulated"
            self.MAC_address = b"\x53\x49\x4d\x4a\x41\x4d"

        @property
        def status(self):
            return 0

        @property
        def is_connected(self):
            return sim.wifi_connected

        def scan_networks(self):
            import os
            return [_AP((os.getenv("CIRCUITPY_WIFI_SSID") or "SimNet").encode())]

        def connect_AP(self, ssid, password):
            sim.wifi_connected = True

        @property
        def ap_info(self):
            import os
            return _AP(os.getenv("CIRCUITPY_WIFI_SSID") or "SimNet")

        @property
        def ipv4_address(self):
            return "127.0.0.1"

    esp_mod.ESP_SPIcontrol = ESP_SPIcontrol

    acm = _mod("adafruit_connection_manager")
    acm.get_radio_socketpool = lambda esp: None
    acm.get_radio_ssl_context = lambda esp: None

    # ── requests (real HTTP to the real backend) ────────────────────────
    areq = _mod("adafruit_requests")

    class _Resp:
        def __init__(self, body, status):
            self._body = body
            self.status_code = status

        @property
        def text(self):
            return self._body

        def json(self):
            return _json.loads(self._body)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    class Session:
        def __init__(self, pool, ssl_context):
            pass

        def post(self, url, data=None, headers=None, timeout=30):
            headers = dict(headers or {})
            # Cloudflare rejects urllib's default UA with error 1010
            headers.setdefault("User-Agent", "FruitJamSimulator/1.0")
            req = urllib.request.Request(url, data=data.encode("utf-8"),
                                         headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return _Resp(r.read().decode("utf-8"), r.status)
            except urllib.error.HTTPError as e:
                return _Resp(e.read().decode("utf-8"), e.code)

    areq.Session = Session

    # ── ntp / microcontroller / busio ───────────────────────────────────
    antp = _mod("adafruit_ntp")

    class NTP:
        def __init__(self, pool, cache_seconds=3600):
            pass

        @property
        def datetime(self):
            return time.gmtime()

    antp.NTP = NTP

    mc = _mod("microcontroller")
    mc.cpu = types.SimpleNamespace(uid=b"SIMULATED-UID")

    busio = _mod("busio")

    class UART:
        def __init__(self, tx, rx, baudrate=9600, timeout=1):
            pass

        def reset_input_buffer(self):
            pass

    busio.UART = UART

    # ── fingerprint sensor ──────────────────────────────────────────────
    afp = _mod("adafruit_fingerprint")
    afp.OK = 0
    afp.NOFINGER = 2
    afp.NOTFOUND = 9

    class Adafruit_Fingerprint:
        def __init__(self, uart):
            self.finger_id = None
            self.confidence = 0
            self._captured = None

        def get_image(self):
            if sim.finger_slot is not None:
                self._captured = sim.finger_slot
                return afp.OK
            return afp.NOFINGER

        def image_2_tz(self, slot):
            return afp.OK if self._captured is not None else afp.NOTFOUND

        def finger_search(self):
            if self._captured in sim.enrolled:
                self.finger_id = self._captured
                self.confidence = 100
                return afp.OK
            return afp.NOTFOUND

    afp.Adafruit_Fingerprint = Adafruit_Fingerprint

    # ── supervisor + stdin (the external keyboard) ──────────────────────
    supervisor = _mod("supervisor")

    class _Runtime:
        @property
        def serial_bytes_available(self):
            if sim.stop:
                raise SystemExit
            sim.loop_started = True
            return len(sim.kbd_buffer)

    supervisor.runtime = _Runtime()
    supervisor.reload = lambda: None

    class _Stdin:
        def read(self, n):
            out = "".join(sim.kbd_buffer[:n])
            del sim.kbd_buffer[:n]
            return out

    sys.stdin = _Stdin()
