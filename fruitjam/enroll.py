# enroll.py - one-time fingerprint enrollment helper
#
# Run from Thonny's shell with the Fruit Jam connected:
#   >>> import enroll
#   >>> enroll.enroll(1)        # store your finger in slot 1
#   >>> enroll.enroll(2)        # another finger (or the same one again)
#
# code.py's finger_search() matches against whatever slots are stored here.

import board
import digitalio
import busio
from time import sleep
import adafruit_fingerprint

fp_power = digitalio.DigitalInOut(board.D6)
fp_power.direction = digitalio.Direction.OUTPUT
fp_power.value = True
sleep(0.5)

uart = busio.UART(board.D8, board.D9, baudrate=57600, timeout=1)
finger = adafruit_fingerprint.Adafruit_Fingerprint(uart)


def enroll(location):
    for pass_num in (1, 2):
        print('Place finger on sensor...' if pass_num == 1
              else 'Place the same finger again...')
        while finger.get_image() != adafruit_fingerprint.OK:
            pass
        if finger.image_2_tz(pass_num) != adafruit_fingerprint.OK:
            print('Could not template the image')
            return False
        if pass_num == 1:
            print('Remove finger...')
            while finger.get_image() != adafruit_fingerprint.NOFINGER:
                pass
    if finger.create_model() != adafruit_fingerprint.OK:
        print('Prints did not match each other')
        return False
    if finger.store_model(location) != adafruit_fingerprint.OK:
        print('Store failed')
        return False
    print('Stored fingerprint in slot', location)
    return True


def clear_all():
    if finger.empty_library() == adafruit_fingerprint.OK:
        print('All stored fingerprints erased')
    else:
        print('Erase failed')
