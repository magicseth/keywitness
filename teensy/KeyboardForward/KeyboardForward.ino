#include "USBHost_t36.h"

USBHost myusb;
USBHub hub1(myusb);
KeyboardController keyboard1(myusb);

USBHIDParser hid1(myusb);

const int blue   = 2;
const int red    = 3;
const int yellow = 23;
const int green  = 22;

const int buttonGround = 30;
const int buttonActive = 32;

unsigned long idle = 0;

bool recording = 0;

String record = "";

void setup()
{
	Serial.println("KeyWitness Hardware Ready");
	
	myusb.begin();
	
	keyboard1.attachPress(OnPress);
	
	pinMode(blue, OUTPUT);
	pinMode(red, OUTPUT);
	pinMode(yellow, OUTPUT);
	pinMode(green, OUTPUT);

	pinMode(buttonGround, OUTPUT);
	pinMode(buttonActive, INPUT_PULLUP);
	digitalWrite(buttonGround, 0);

  cycle();
}

void loop()
{
	myusb.Task();
	
	if (millis() - idle > 250) {
  	digitalWrite(blue,   0);
	  digitalWrite(red,    0);
	  digitalWrite(yellow, 0);
	  digitalWrite(green,  0);
	}

  if (digitalRead(buttonActive) == 0) {
		delay(50);
		if (digitalRead(buttonActive) == 0) {
      Serial.print("Recording: ");
			Serial.print(recording);
			Serial.print(" -> ");
			recording = recording ? false : true;
			Serial.println(recording);
			if (!recording) record = "";
			cycle();
		}
	}
}

void cycle()
{
	int wait = 100;
	digitalWrite(blue, 1);
	delay(wait);
	digitalWrite(blue, 0);
	digitalWrite(red, 1);
	delay(wait);
	digitalWrite(red, 0);
	digitalWrite(green, 1);
	delay(wait);
	digitalWrite(green, 0);
	digitalWrite(yellow, 1);
	delay(wait);
	digitalWrite(yellow, 0);
}

void OnPress(int key)
{
	/*
	Serial.print("key '");
	switch (key) {
	case KEYD_UP       : Serial.print("UP"); break;
	case KEYD_DOWN    : Serial.print("DN"); break;
	case KEYD_LEFT     : Serial.print("LEFT"); break;
	case KEYD_RIGHT   : Serial.print("RIGHT"); break;
	case KEYD_INSERT   : Serial.print("Ins"); break;
	case KEYD_DELETE   : Serial.print("Del"); break;
	case KEYD_PAGE_UP  : Serial.print("PUP"); break;
	case KEYD_PAGE_DOWN: Serial.print("PDN"); break;
	case KEYD_HOME     : Serial.print("HOME"); break;
	case KEYD_END      : Serial.print("END"); break;
	case KEYD_F1       : Serial.print("F1"); break;
	case KEYD_F2       : Serial.print("F2"); break;
	case KEYD_F3       : Serial.print("F3"); break;
	case KEYD_F4       : Serial.print("F4"); break;
	case KEYD_F5       : Serial.print("F5"); break;
	case KEYD_F6       : Serial.print("F6"); break;
	case KEYD_F7       : Serial.print("F7"); break;
	case KEYD_F8       : Serial.print("F8"); break;
	case KEYD_F9       : Serial.print("F9"); break;
	case KEYD_F10      : Serial.print("F10"); break;
	case KEYD_F11      : Serial.print("F11"); break;
	case KEYD_F12      : Serial.print("F12"); break;
	default: Serial.print((char)key); break;
	}
	Serial.print("'  ");
	Serial.print(key);
	Serial.print(" MOD: ");
	Serial.print(keyboard1.getModifiers(), HEX);
	Serial.print(" OEM: ");
	Serial.print(keyboard1.getOemKey(), HEX);
	Serial.print(" LEDS: ");
	Serial.println(keyboard1.LEDS(), HEX);
	*/
  Keyboard.print((char)key);

  if (!recording) { return; }

  unsigned long last = millis() - idle;
  idle = millis();

	record.concat(key);
	record.concat(",");
	record.concat(last);
	record.concat("|");
	Serial.println(record);

	digitalWrite(blue,   random(0, 2));
	digitalWrite(red,    random(0, 2));
	digitalWrite(yellow, random(0, 2));
	digitalWrite(green,  random(0, 2));
}
