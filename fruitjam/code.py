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

def base64url(s):
    if isinstance(s, str):
        s = s.encode('ascii')
    result = binascii.b2a_base64(s).decode('ascii')
    result = result.replace('+', '-').replace('/', '_').replace('=', '').replace('\n', '')
    return result

# random pixel show while the long signing hashes run (called per block)
sha512.on_block = flash_display

def drain_keyboard():
    """Discard buffered keystrokes — the keyboard is disabled while busy."""
    while supervisor.runtime.serial_bytes_available:
        sys.stdin.read(supervisor.runtime.serial_bytes_available)

def type_over_host(previous, message):
    """Backspace `previous` out of the host's text field, then type `message`."""
    for _ in range(len(previous)):
        keyboard.send(Keycode.BACKSPACE)
    if message:
        layout.write(message)

def flash_sensor():
    # each get_image lights the sensor LED (find mode), so a quick burst
    # reads as a deliberate flash, distinct from the slower idle polling
    for _ in range(3):
        try:
            finger.get_image()
        except Exception:
            pass
        sleep(0.12)

def start_recording():
    global enabled, record, text
    record = ''
    text = ''
    enabled = True
    led.value = True
    if finger:
        flash_sensor()  # LED flash is the "recording" cue

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
    if len(text) == 0:
        fp_start_slot = None
        fp_start_time = None
        return

    # the identity only counts if the SAME enrolled finger started and
    # ended the recording — a mid-session swap gets the anonymous device key
    fp_end_time = format_time(ntp.datetime) if end_slot is not None else None
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

    # let the host see progress while the slow crypto runs
    layout.write('encrypting')
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
    timestamp = format_time(ntp.datetime)
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
        # the fragment carries the decryption key to viewers
        # without it ever reaching the server
        share_url = (result['url'].replace('https://www.', 'https://')
                     + '#' + base64url(enc_key))
        print('Share URL:', share_url)
        print()
        credit = ('typed by ' + name + ' ') if name else ''
        type_over_host(typed, credit + share_url)
    else:
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
    while not esp.is_connected:
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
            try:
                print('Trying', s, '...')
                esp.connect_AP(s, p)
                print('Connected to', s)
                return
            except (OSError, RuntimeError) as e:
                print('Failed:', e)

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
print('Network time:', format_time(ntp.datetime))
print()
print('Ready!')
print()
drain_keyboard()   # discard anything typed before we were online

last_fp_poll = 0
last_key = 0
fp_touch_ready = True  # finger must lift between touch events

while True:
    # keystrokes come first so passthrough and the per-key pixel flashes
    # stay snappy; the sensor poll below blocks the loop for ~100ms
    available = supervisor.runtime.serial_bytes_available
    if available:
        c = sys.stdin.read(available)
        last_key = monotonic()
        if enabled:
            code = ord(c)
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
        layout.write(c)
        continue
    elif monotonic() - last_flash > 0.25:
        pixels.fill((0, 0, 0))

    # buttons still work: start recording, or send without a fingerprint match
    if not button1.value or not button2.value or not button3.value:
        if enabled:
            attest_and_send(None)
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
        except Exception:
            r = None
        if r == adafruit_fingerprint.OK:
            if fp_touch_ready:
                fp_touch_ready = False
                slot = fingerprint_slot()
                if enabled:
                    attest_and_send(slot)
                else:
                    # remember who started; the ending touch must match
                    fp_start_slot = slot
                    fp_start_time = format_time(ntp.datetime)
                    start_recording()
        elif r == adafruit_fingerprint.NOFINGER:
            fp_touch_ready = True
