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

ssid = getenv('CIRCUITPY_WIFI_SSID')
password = getenv('CIRCUITPY_WIFI_PASSWORD')
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

def fingerprint_matches():
    """The touch image is already captured; template it and search."""
    try:
        if finger.image_2_tz(1) != adafruit_fingerprint.OK:
            return False
        return finger.finger_search() == adafruit_fingerprint.OK
    except Exception as e:
        print('Fingerprint match error:', e)
        return False

def attest_and_send(fingerprint_verified):
    global enabled, record, text
    enabled = False
    led.value = False
    if len(text) == 0:
        return

    print('Record:', record)
    print()
    print('Text:\n\n' + text + '\n')
    print('Fingerprint verified:', fingerprint_verified)
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
    inner_json = json.dumps({'cleartext': text})
    encrypted = base64url(nonce + gcm.encrypt(enc_key, nonce, inner_json.encode('utf-8')))

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

    # signature — Ed25519 over the canonical payload bytes
    sk = binascii.unhexlify(secret_key.encode('ascii'))
    pk = binascii.unhexlify(public_key.encode('ascii'))
    s  = ed25519.signature_unsafe(payload_json.encode('utf-8'), sk, pk)
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
    block = ('-----BEGIN KEYWITNESS ATTESTATION-----\n' + encoded +
             '\n-----END KEYWITNESS ATTESTATION-----')
    data = json.dumps({'attestation': block})
    try:
        with requests.post(url, data=data, headers={'Content-Type': 'application/json'}) as response:
            result = response.json()
            print(result)
            print()
            if 'url' in result:
                # the fragment carries the decryption key to viewers
                # without it ever reaching the server
                share_url = result['url'] + '#' + base64url(enc_key)
                print('Share URL:', share_url)
                print()
                type_over_host(typed, share_url)
            else:
                type_over_host(typed, '[error]')
    except Exception as e:
        print(f'Posting error: {e}')
        type_over_host(typed, '[error]')

    record = ''
    text = ''

print()
if esp.status == adafruit_esp32spi.WL_IDLE_STATUS:
    print('ESP32 wireless co-proc found and in idle mode')
print('Wifi firmware:', esp.firmware_version)
print('MAC address:', ':'.join('%02X' % byte for byte in esp.MAC_address))
print('Connecting...')
while not esp.is_connected:
    try:
        esp.connect_AP(ssid, password)
    except OSError as e:
        print('Failure; retrying: ', e)
        continue
print('Connected to', esp.ap_info.ssid)
print('RSSI:', esp.ap_info.rssi)
print('IP:', esp.ipv4_address)
print()
print('Network time:', format_time(ntp.datetime))
print()
print('Ready!')
print()

last_fp_poll = 0
fp_touch_ready = True  # finger must lift between touch events

while True:
    # buttons still work: start recording, or send without a fingerprint match
    if not button1.value or not button2.value or not button3.value:
        if enabled:
            attest_and_send(False)
        else:
            start_recording()
        sleep(0.5)

    # fingerprint touch: first touch starts recording (sensor power-cycle
    # flash is the cue), next touch verifies the finger and sends
    now = monotonic()
    if finger and now - last_fp_poll > 0.25:
        last_fp_poll = now
        try:
            r = finger.get_image()
        except Exception:
            r = None
        if r == adafruit_fingerprint.OK:
            if fp_touch_ready:
                fp_touch_ready = False
                if enabled:
                    attest_and_send(fingerprint_matches())
                else:
                    start_recording()
        elif r == adafruit_fingerprint.NOFINGER:
            fp_touch_ready = True

    available = supervisor.runtime.serial_bytes_available
    if available:
        c = sys.stdin.read(available)
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
    elif monotonic() - last_flash > 0.25:
        pixels.fill((0, 0, 0))
