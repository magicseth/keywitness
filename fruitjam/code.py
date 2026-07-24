# button
import board
import digitalio

# USB host
import sys
import supervisor

# NeoPixel
import neopixel

# HID device
import usb_hid
from adafruit_hid.keyboard import Keyboard
from adafruit_hid.keyboard_layout_us import KeyboardLayoutUS
from adafruit_hid.keycode import Keycode

# wifi
from adafruit_esp32spi import adafruit_esp32spi
from os import getenv, urandom
import adafruit_connection_manager
import adafruit_requests

# fingerprint sensor
import busio
import adafruit_fingerprint

# external keyboard, read directly over USB host
import array
try:
    import usb.core
    import adafruit_usb_host_descriptors
except ImportError:
    usb = None  # simulator / no USB host support

# attestation
import hashlib
import ed25519
import gcm
import sha512
import adafruit_ntp
import json
import binascii
import microcontroller

# other
from random import randint
from time import monotonic, sleep

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT
led.value = True

# The external keyboard is only powered while recording: touch the sensor
# and the keyboard lighting up IS the record indicator. It goes dark again
# the moment the ending touch lands, through encryption and upload.
usb_host_power = None
try:
    usb_host_power = digitalio.DigitalInOut(board.USB_HOST_5V_POWER)
    usb_host_power.switch_to_output(value=False)
except Exception as e:
    print('USB host power control unavailable:', e)

button1 = digitalio.DigitalInOut(board.BUTTON1)
button1.switch_to_input(pull=digitalio.Pull.UP)
button2 = digitalio.DigitalInOut(board.BUTTON2)
button2.switch_to_input(pull=digitalio.Pull.UP)
button3 = digitalio.DigitalInOut(board.BUTTON3)
button3.switch_to_input(pull=digitalio.Pull.UP)

pixels = neopixel.NeoPixel(board.NEOPIXEL, 5, brightness=0.3)
last_flash = 0
enabled = False

keyboard = Keyboard(usb_hid.devices)
layout = KeyboardLayoutUS(keyboard)

# Known wifi networks, tried in order (visible ones first) so the same
# device works across demo venues. settings.toml:
#   CIRCUITPY_WIFI_SSID / _PASSWORD          primary network
#   KEYWITNESS_WIFI_1_SSID / _PASSWORD       extra networks, any count
#   KEYWITNESS_WIFI_2_SSID / _PASSWORD ...
networks = []
if getenv('CIRCUITPY_WIFI_SSID'):
    networks.append((getenv('CIRCUITPY_WIFI_SSID'), getenv('CIRCUITPY_WIFI_PASSWORD') or ''))
for _i in range(1, 21):
    _s = getenv(f'KEYWITNESS_WIFI_{_i}_SSID')
    if _s:
        networks.append((_s, getenv(f'KEYWITNESS_WIFI_{_i}_PASSWORD') or ''))

url = 'https://www.keywitness.io/api/attestations'

esp32_cs = digitalio.DigitalInOut(board.ESP_CS)
esp32_ready = digitalio.DigitalInOut(board.ESP_BUSY)
esp32_reset = digitalio.DigitalInOut(board.ESP_RESET)

spi = board.SPI()
esp = adafruit_esp32spi.ESP_SPIcontrol(spi, esp32_cs, esp32_ready, esp32_reset)

pool = adafruit_connection_manager.get_radio_socketpool(esp)
ssl_context = adafruit_connection_manager.get_radio_ssl_context(esp)
requests = adafruit_requests.Session(pool, ssl_context)

ntp = adafruit_ntp.NTP(pool, cache_seconds=3600)

# ── Audio: modem song while connecting, beep-boop while encrypting, and a
# paper-airplane swoosh on send. Samples are DMA-looped, so they keep playing
# while the CPU is buried in crypto or a blocking upload. Must be set up
# AFTER the ESP32 (initializing the ESP after I2S breaks audio — CP #10461).
audio_out = None
snd_modem = snd_working = snd_swoosh = None
try:
    import audiobusio
    import audiocore
    import adafruit_tlv320
    import array
    import math

    _dac = adafruit_tlv320.TLV320DAC3100(board.I2C())
    _dac.configure_clocks(sample_rate=22050, bit_depth=16)
    _dac.speaker_output = True
    _dac.headphone_output = True
    _dac.dac_volume = 0        # silent without this — full-scale DAC level
    _dac.speaker_mute = False  # and this — the speaker amp starts muted
    _dac.headphone_left_mute = False
    _dac.headphone_right_mute = False
    _dac.speaker_volume = 0    # demo-floor loud; drop toward -16 if it distorts
    _dac.headphone_volume = -10

    _RATE = 22050
    _TAU = 2 * math.pi

    def _tone(period, seconds, vol=0.5):
        # one exact cycle tiled — freq = 22050/period, phase-continuous
        cycle = [int(32000 * vol * math.sin(_TAU * i / period)) for i in range(period)]
        return cycle * int(_RATE * seconds / period)

    def _silence(seconds):
        return [0] * int(_RATE * seconds)

    def _static(seconds, vol=0.35):
        peak = int(32000 * vol)
        return [randint(-peak, peak) for _ in range(int(_RATE * seconds))]

    def _sample(data):
        return audiocore.RawSample(array.array('h', data), sample_rate=_RATE)

    def _mix(a, b):
        return [max(-32000, min(32000, x + y)) for x, y in zip(a, b)]

    # the real dial-up liturgy, in order (loops): dial tone (350+440Hz),
    # three DTMF digits, the 2100Hz answer tone, V.21 warble, then the
    # famous static crescendo
    _dial = _mix(_tone(63, 0.35, 0.3), _tone(50, 0.35, 0.3))
    _digits = []
    for _lo, _hi in ((29, 18), (26, 16), (32, 15)):
        _digits += _mix(_tone(_lo, 0.11, 0.3), _tone(_hi, 0.11, 0.3)) + _silence(0.06)
    _answer = _silence(0.15) + _tone(10, 0.4, 0.45)
    _warble = []
    for _ in range(9):
        _warble += _tone(22, 0.035, 0.45) + _tone(13, 0.035, 0.45)
    snd_modem = _sample(_dial + _digits + _answer + _warble +
                        _static(0.3, 0.28) + _tone(17, 0.1, 0.4) +
                        _static(0.6, 0.4) + _silence(0.2))

    # beep ... boop ... (loops)
    snd_working = _sample(
        _tone(25, 0.12) + _silence(0.13) + _tone(50, 0.12) + _silence(0.23))

    # falling whistle fading out over a breath of air: the airplane departs
    _sw = []
    _steps = (12, 14, 17, 21, 26, 33, 42, 54)
    for _n, _p in enumerate(_steps):
        _v = 0.55 * (1.0 - _n / len(_steps))
        _sw += _tone(_p, 0.07, _v)
    _air = _static(len(_sw) / _RATE, 0.18)
    snd_swoosh = _sample([max(-32000, min(32000, a + b)) for a, b in zip(_sw, _air)])

    audio_out = audiobusio.I2SOut(board.I2S_BCLK, board.I2S_WS, board.I2S_DIN)
    print('Audio ready')
except Exception as e:
    print('Audio unavailable:', e)

def sound_loop(sample):
    if audio_out and sample:
        audio_out.play(sample, loop=True)

def sound_once(sample):
    if audio_out and sample:
        audio_out.play(sample)

def sound_stop():
    if audio_out:
        audio_out.stop()

secret_key = getenv('KEYWITNESS_SECRET_KEY')
public_key = getenv('KEYWITNESS_PUBLIC_KEY')
unique_id  = f'{board.board_id}-{microcontroller.cpu.uid.hex()}'

# Device default signing key, with the slow part of Ed25519 key setup
# (an SHA-512 of the secret) done once at boot
dev_pk = binascii.unhexlify(public_key.encode('ascii'))
dev_prefix, dev_a = ed25519.expand_secret(binascii.unhexlify(secret_key.encode('ascii')))

# Fingerprint slot -> signing identity. Each enrolled person gets their own
# keypair; the backend maps public key -> claimed username, so a matched
# finger makes the attestation come out as typed.by/<username>/<n>.
# settings.toml:
#   KEYWITNESS_ID_<slot>_NAME / _SECRET_KEY / _PUBLIC_KEY
identities = {}
for _slot in range(1, 200):
    _name = getenv(f'KEYWITNESS_ID_{_slot}_NAME')
    if _name:
        _pk = binascii.unhexlify(getenv(f'KEYWITNESS_ID_{_slot}_PUBLIC_KEY').encode('ascii'))
        _prefix, _a = ed25519.expand_secret(
            binascii.unhexlify(getenv(f'KEYWITNESS_ID_{_slot}_SECRET_KEY').encode('ascii')))
        identities[_slot] = (_name, _pk, _prefix, _a)
if identities:
    print('Identities:', ', '.join(f'{s}={n}' for s, (n, _, _, _) in sorted(identities.items())))

# Fingerprint sensor (Adafruit 4690) on the standard UART:
#   sensor RX (white)  <- D8/GPIO8 (TX)
#   sensor TX (green)  -> D9/GPIO9 (RX)
#   sensor VCC (red)   <- 3.3V
#   sensor GND (black) <- GND
finger = None
try:
    fp_uart = busio.UART(board.TX, board.RX, baudrate=57600, timeout=1)
    finger = adafruit_fingerprint.Adafruit_Fingerprint(fp_uart)
    print('Fingerprint sensor ready')
except Exception as e:
    print('Fingerprint sensor not available:', e)

record = ''
text = ''
fp_start_slot = None   # who touched to start recording
fp_start_time = None

def flash_display():
    global last_flash
    values = [randint(0, 1) for p in pixels]
    for index in range(len(values)):
        if values[index] == 1:
            red   = randint(0, 255)
            green = randint(0, 255)
            blue  = randint(0, 255)
            pixels[index] = (red, green, blue)
        else:
            pixels[index] = (0, 0, 0)
        pixels.show()
    last_flash = monotonic()

def format_time(t):
    return f'{t.tm_year}-{t.tm_mon:02}-{t.tm_mday:02}T{t.tm_hour:02}:{t.tm_min:02}:{t.tm_sec:02}.000Z'

def network_time():
    """NTP time as an ISO string; the UDP fetch can time out, so retry.
    Cached by adafruit_ntp for an hour once it succeeds."""
    for attempt in range(5):
        try:
            return format_time(ntp.datetime)
        except OSError as e:
            print('NTP retry:', e)
            sleep(1)
    raise OSError('NTP unavailable after retries')

def base64url(s):
    if isinstance(s, str):
        s = s.encode('ascii')
    result = binascii.b2a_base64(s).decode('ascii')
    result = result.replace('+', '-').replace('/', '_').replace('=', '').replace('\n', '')
    return result

# random pixel show while the long signing hashes run (called per block)
sha512.on_block = flash_display

# ── Direct USB-host keyboard input ───────────────────────────────────────────
# CircuitPython's built-in keyboard→console routing doesn't reliably re-attach
# after the host port is power-cycled, so we claim the keyboard ourselves and
# read boot-protocol HID reports directly. Console stdin still works as a
# fallback input (and is how the simulator types).

kbd = None
kbd_ep = None
kbd_buf = array.array('b', [0] * 8)
kbd_prev = set()

_KEYS_LOWER = {40: '\n', 42: '\x08', 43: '\t', 44: ' ', 45: '-', 46: '=',
               47: '[', 48: ']', 49: '\\', 51: ';', 52: "'", 53: '`',
               54: ',', 55: '.', 56: '/'}
_KEYS_UPPER = {40: '\n', 42: '\x08', 43: '\t', 44: ' ', 45: '_', 46: '+',
               47: '{', 48: '}', 49: '|', 51: ':', 52: '"', 53: '~',
               54: '<', 55: '>', 56: '?'}
for _i in range(26):
    _KEYS_LOWER[4 + _i] = chr(ord('a') + _i)
    _KEYS_UPPER[4 + _i] = chr(ord('A') + _i)
for _i, (_d, _s) in enumerate(zip('1234567890', '!@#$%^&*()')):
    _KEYS_LOWER[30 + _i] = _d
    _KEYS_UPPER[30 + _i] = _s

def keyboard_attach(timeout_s=6.0):
    """Find a boot keyboard on the host port and claim it."""
    global kbd, kbd_ep, kbd_prev
    kbd = None
    kbd_prev = set()
    if usb is None:
        return False
    deadline = monotonic() + timeout_s
    while monotonic() < deadline:
        try:
            for device in usb.core.find(find_all=True):
                idx, ep = adafruit_usb_host_descriptors.find_boot_keyboard_endpoint(device)
                if idx is not None and ep is not None:
                    if device.is_kernel_driver_active(idx):
                        device.detach_kernel_driver(idx)
                    device.set_configuration()
                    kbd = device
                    kbd_ep = ep
                    return True
        except Exception as e:
            print('Keyboard scan error:', e)
        sleep(0.3)
    return False

def keyboard_read():
    """Newly pressed characters from the claimed keyboard ('' if none)."""
    global kbd_prev, kbd
    if not kbd:
        return ''
    try:
        kbd.read(kbd_ep, kbd_buf, timeout=5)
    except usb.core.USBTimeoutError:
        return ''
    except Exception as e:
        print('Keyboard read error:', e)
        kbd = None
        return ''
    shift = bool(kbd_buf[0] & 0x22)
    table = _KEYS_UPPER if shift else _KEYS_LOWER
    keys = set(k & 0xFF for k in kbd_buf[2:8] if k)
    out = ''.join(table.get(k, '') for k in keys - kbd_prev)
    kbd_prev = keys
    return out

def drain_keyboard():
    """Discard buffered keystrokes — the keyboard is disabled while busy."""
    while supervisor.runtime.serial_bytes_available:
        sys.stdin.read(supervisor.runtime.serial_bytes_available)
    for _ in range(8):
        if not keyboard_read():
            break

def keyboard_on():
    """Power the external keyboard, claim it, and narrate failure over HID."""
    if usb_host_power:
        usb_host_power.value = True
        sleep(1.0)
    if usb is not None and not keyboard_attach():
        layout.write('[keyboard not found] ')
    drain_keyboard()

def keyboard_off():
    global kbd
    if usb_host_power:
        usb_host_power.value = False
    kbd = None
    drain_keyboard()

def type_error(e):
    # narrate failures over the HID channel so problems are visible
    # without a serial console
    layout.write(' [error: ' + str(e)[:48] + ']')

def type_over_host(previous, message):
    """Backspace `previous` out of the host's text field, then type `message`."""
    for _ in range(len(previous)):
        keyboard.send(Keycode.BACKSPACE)
    if message:
        layout.write(message)

def start_recording():
    global enabled, record, text
    record = ''
    text = ''
    enabled = True
    led.value = True
    keyboard_on()   # the keyboard lighting up is the record indicator
    # green double-flash on the NeoPixels = keyboard enumerated, start typing.
    # (Deliberately NOT extra sensor commands — bursting get_image desyncs
    # the sensor's UART protocol and starves the main loop.)
    for _ in range(2):
        pixels.fill((0, 60, 0))
        pixels.show()
        sleep(0.12)
        pixels.fill((0, 0, 0))
        pixels.show()
        sleep(0.12)

def fingerprint_slot():
    """The touch image is already captured; template it and search.
    Returns the matched slot number, or None."""
    try:
        if finger.image_2_tz(1) != adafruit_fingerprint.OK:
            return None
        if finger.finger_search() != adafruit_fingerprint.OK:
            return None
        return finger.finger_id
    except Exception as e:
        print('Fingerprint match error:', e)
        return None

def attest_and_send(end_slot):
    global enabled, record, text, fp_start_slot, fp_start_time, last_fp_poll
    enabled = False
    led.value = False
    keyboard_off()   # dark through encryption and upload
    if len(text) == 0:
        fp_start_slot = None
        fp_start_time = None
        return

    # the identity only counts if the SAME enrolled finger started and
    # ended the recording — a mid-session swap gets the anonymous device key
    fp_end_time = network_time() if end_slot is not None else None
    fingerprint_verified = end_slot is not None and end_slot == fp_start_slot
    name, pk, sig_prefix, a_scalar = None, dev_pk, dev_prefix, dev_a
    if fingerprint_verified and end_slot in identities:
        name, pk, sig_prefix, a_scalar = identities[end_slot]

    print('Record:', record)
    print()
    print('Text:\n\n' + text + '\n')
    print('Fingerprint start slot:', fp_start_slot, 'end slot:', end_slot,
          '-> signing as', name if name else 'device key')
    print()

    # let the host see progress while the slow crypto runs; the newline
    # stays after the backspaces so the URL lands on its own line
    sound_loop(snd_working)   # beep boop, DMA keeps it going through crypto
    layout.write('\nencrypting')
    typed = 'encrypting'

    # hash record
    sha = hashlib.new('sha256')
    sha.update(record.encode('ascii'))
    digest = sha.digest()

    # biohash
    biohash = digest.hex()
    print('Biohash:', biohash)
    print()

    # timestamp
    timestamp = network_time()
    print('Timestamp:', timestamp)
    print()

    # device ID
    sha = hashlib.new('sha256')
    sha.update(unique_id.encode('ascii'))
    deviceID = sha.digest()
    print('DeviceID:', deviceID.hex())
    print()

    # encrypt cleartext (v2) — the server only ever sees the hash and
    # the AES-GCM ciphertext; the key goes in the share URL fragment,
    # which browsers never send to the server
    enc_key = urandom(32)
    nonce = urandom(12)
    inner = {'cleartext': text}
    # start/end touch times ride inside the encrypted evidence — the signed
    # payload's field set is fixed by the server, but the inner JSON is ours
    if fp_start_time:
        inner['fingerprintStart'] = fp_start_time
    if fp_end_time:
        inner['fingerprintEnd'] = fp_end_time
    inner_json = json.dumps(inner)
    flash_display()
    encrypted = base64url(nonce + gcm.encrypt(enc_key, nonce, inner_json.encode('utf-8')))
    flash_display()

    sha = hashlib.new('sha256')
    sha.update(text.encode('utf-8'))
    cleartext_hash = base64url(sha.digest())
    print('CleartextHash:', cleartext_hash)
    print()

    # payload — must be the JCS canonical form (sorted keys, no
    # whitespace) because the signature is computed over these exact
    # bytes and the server re-canonicalizes before verifying.
    # Built by hand: CircuitPython json.dumps has no sort_keys.
    fp_json = 'true' if fingerprint_verified else 'false'
    payload_json = ('{"cleartextHash":"' + cleartext_hash + '"' +
        ',"deviceId":"' + deviceID.hex() + '"' +
        ',"encryptedCleartext":"' + encrypted + '"' +
        ',"faceIdVerified":' + fp_json +
        ',"keystrokeBiometricsHash":"' + biohash + '"' +
        ',"timestamp":"' + timestamp + '"' +
        ',"version":"keywitness-v2"}')
    print('Payload:', payload_json)
    print()

    # signature — Ed25519 over the canonical payload bytes, with the
    # matched person's key (or the device key if no identity matched);
    # the key hash was precomputed at boot so this is just the curve math
    s = ed25519.signature_cached(payload_json.encode('utf-8'), sig_prefix, a_scalar, pk)
    print('Signature:', binascii.hexlify(s).decode('ascii'))
    print()

    # attestation — payload fields plus base64url of the RAW key and
    # signature bytes, keys still in sorted order
    attest_json = ('{"cleartextHash":"' + cleartext_hash + '"' +
        ',"deviceId":"' + deviceID.hex() + '"' +
        ',"encryptedCleartext":"' + encrypted + '"' +
        ',"faceIdVerified":' + fp_json +
        ',"keystrokeBiometricsHash":"' + biohash + '"' +
        ',"publicKey":"' + base64url(pk) + '"' +
        ',"signature":"' + base64url(s) + '"' +
        ',"timestamp":"' + timestamp + '"' +
        ',"version":"keywitness-v2"}')
    print('Attestation:', attest_json)
    print()

    # encode
    encoded = base64url(attest_json)

    # post — json.dumps escapes the newlines inside the block so the
    # body is valid JSON
    print('Posting to ' + url + '...')
    print()
    # steady blue while uploading (can't animate inside the blocking post)
    pixels.fill((0, 0, 40))
    pixels.show()
    block = ('-----BEGIN KEYWITNESS ATTESTATION-----\n' + encoded +
             '\n-----END KEYWITNESS ATTESTATION-----')
    data = json.dumps({'attestation': block})

    # the ESP32 socket occasionally flakes on the first try — retry with
    # backoff, reconnecting wifi if it dropped, before giving up
    result = None
    for attempt in range(3):
        if not esp.is_connected:
            print('Wifi dropped; reconnecting...')
            connect_wifi()
        try:
            with requests.post(url, data=data, headers={'Content-Type': 'application/json'}, timeout=30) as response:
                result = response.json()
            break
        except Exception as e:
            print(f'Post attempt {attempt + 1} failed: {e}')
            sleep(1 + attempt)
    print(result)
    print()

    drain_keyboard()  # anything typed while busy is discarded
    if result and 'url' in result:
        sound_once(snd_swoosh)   # and away it goes
        # the fragment carries the decryption key to viewers
        # without it ever reaching the server
        share_url = (result['url'].replace('https://www.', 'https://')
                     + '#' + base64url(enc_key))
        print('Share URL:', share_url)
        print()
        credit = ('typed by ' + name + ' ') if name else ''
        type_over_host(typed, credit + share_url)
    else:
        sound_stop()
        type_over_host(typed, '[error]')

    pixels.fill((0, 0, 0))
    pixels.show()
    drain_keyboard()          # keyboard re-enables only now
    last_fp_poll = monotonic()  # sensor stays quiet until the next poll tick
    record = ''
    text = ''
    fp_start_slot = None
    fp_start_time = None

def connect_wifi():
    # narrate over HID with an animated ellipsis, erased once we're online
    banner = 'connecting to wifi'
    sound_loop(snd_modem)
    layout.write(banner)
    dots = 0
    try:
        dots = _connect_wifi()
    finally:
        for _ in range(len(banner) + dots):
            keyboard.send(Keycode.BACKSPACE)
        sound_stop()

def _dot_tick(dots):
    if dots < 3:
        layout.write('.')
        return dots + 1
    for _ in range(3):
        keyboard.send(Keycode.BACKSPACE)
    return 0

def _connect_wifi():
    dots = 0
    while not esp.is_connected:
        dots = _dot_tick(dots)
        # prefer networks the scan can actually see, fall back to trying all
        candidates = networks
        try:
            visible = set()
            for ap in esp.scan_networks():
                s = ap.ssid if hasattr(ap, 'ssid') else ap['ssid']
                if isinstance(s, (bytes, bytearray)):
                    s = str(s, 'utf-8')
                visible.add(s)
            seen = [n for n in networks if n[0] in visible]
            if seen:
                candidates = seen
        except Exception as e:
            print('Scan failed:', e)
        for s, p in candidates:
            dots = _dot_tick(dots)
            try:
                print('Trying', s, '...')
                esp.connect_AP(s, p)
                print('Connected to', s)
                return dots
            except (OSError, RuntimeError) as e:
                print('Failed:', e)
    return dots

print()
if esp.status == adafruit_esp32spi.WL_IDLE_STATUS:
    print('ESP32 wireless co-proc found and in idle mode')
print('Wifi firmware:', esp.firmware_version)
print('MAC address:', ':'.join('%02X' % byte for byte in esp.MAC_address))
print('Connecting...')
connect_wifi()
print('RSSI:', esp.ap_info.rssi)
print('IP:', esp.ipv4_address)
print()
print('Network time:', network_time())
print()
print('Ready!')
print()
# keyboard stays dark until a touch starts a recording

last_fp_poll = 0
last_key = 0
fp_touch_ready = True  # finger must lift between touch events

while True:
    # keystrokes come first so passthrough and the per-key pixel flashes
    # stay snappy; the sensor poll below blocks the loop for ~100ms
    chars = keyboard_read()
    if supervisor.runtime.serial_bytes_available:
        chars += sys.stdin.read(supervisor.runtime.serial_bytes_available)
    if chars:
        last_key = monotonic()
        for c in chars:
            code = ord(c)
            if enabled:
                if (code == 8 or code == 127) and len(text) > 0:
                    text = text[:-1]
                elif code >= 32 and code <= 127:
                    text += c
                if len(record) == 0:
                    record += str(code) + ',0'
                else:
                    record += str(code) + ',' + str(int((monotonic() - last_flash) * 1000))
                record += '|'
                flash_display()
            if code == 8 or code == 127:
                keyboard.send(Keycode.BACKSPACE)
            else:
                layout.write(c)
        continue
    elif monotonic() - last_flash > 0.25:
        pixels.fill((0, 0, 0))

    # buttons still work: start recording, or send without a fingerprint match
    if not button1.value or not button2.value or not button3.value:
        if enabled:
            try:
                attest_and_send(None)
            except Exception as e:
                print('Attest failed:', e)
                sound_stop()
                type_error(e)
                pixels.fill((0, 0, 0))
                pixels.show()
        else:
            fp_start_slot = None
            fp_start_time = None
            start_recording()
        sleep(0.5)

    # fingerprint touch: first touch starts recording (LED flash is the cue),
    # next touch matches the finger and sends. Only polled once typing has
    # paused, so it never lags the keystroke handling above.
    now = monotonic()
    if finger and now - last_fp_poll > 0.25 and now - last_key > 0.5:
        last_fp_poll = now
        try:
            r = finger.get_image()
        except Exception as e:
            # a garbled exchange leaves stale bytes in the UART; flush them
            # so the next poll starts on a clean packet boundary instead of
            # timing out forever (which starves keyboard passthrough)
            r = None
            print('Sensor poll error, resyncing:', e)
            try:
                fp_uart.reset_input_buffer()
            except Exception:
                pass
        if r == adafruit_fingerprint.OK:
            if fp_touch_ready:
                fp_touch_ready = False
                slot = fingerprint_slot()
                if enabled:
                    try:
                        attest_and_send(slot)
                    except Exception as e:
                        print('Attest failed:', e)
                        sound_stop()
                        type_error(e)
                        pixels.fill((0, 0, 0))
                        pixels.show()
                else:
                    # remember who started; the ending touch must match
                    fp_start_slot = slot
                    try:
                        fp_start_time = network_time()
                    except OSError:
                        fp_start_time = None
                    start_recording()
        elif r == adafruit_fingerprint.NOFINGER:
            fp_touch_ready = True
