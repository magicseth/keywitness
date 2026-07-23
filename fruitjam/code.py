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

# wifi
from adafruit_esp32spi import adafruit_esp32spi
from os import getenv, urandom
import adafruit_connection_manager
import adafruit_requests

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

while True:
    if not button1.value or not button2.value or not button3.value:
        if enabled and len(text) > 0:
            print('Record:', record)
            print()
            print('Text:\n\n' + text + '\n')

            # hash record
            sha = hashlib.new('sha256')
            sha.update(record.encode('ascii'))
            digest = sha.digest()
            print('Digest:', digest.hex())
            print()

            # biohash
            biohash = ''
            hexLc = '0123456789abcdef'
            for i in range(32):
                biohash += hexLc[digest[i] >> 4]
                biohash += hexLc[digest[i] & 0x0f]
            print('Biohash:', biohash) #.hex())
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
            payload_json = ('{"cleartextHash":"' + cleartext_hash + '"' +
                ',"deviceId":"' + deviceID.hex() + '"' +
                ',"encryptedCleartext":"' + encrypted + '"' +
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
                ',"keystrokeBiometricsHash":"' + biohash + '"' +
                ',"publicKey":"' + base64url(pk) + '"' +
                ',"signature":"' + base64url(s) + '"' +
                ',"timestamp":"' + timestamp + '"' +
                ',"version":"keywitness-v2"}')
            print('Attestation:', attest_json)
            print()

            # encode
            encoded = base64url(attest_json)
            print('Base64URL:', encoded)
            print()

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
                        print('Share URL:', result['url'] + '#' + base64url(enc_key))
                        print()
            except Exception as e:
                print(f'Posting error: {e}')
            record = ''
            text = ''
        led.value = enabled
        enabled = not enabled
        sleep(0.5)

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