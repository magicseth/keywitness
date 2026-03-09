# KeyWitness Hardware Keyboard Specification

## Overview

KeyWitness is a physical keyboard with per-key capacitive touch sensors, an integrated fingerprint reader, a secure element, and secure boot that cryptographically attests typed text. It produces Ed25519-signed attestation blocks proving that text was physically typed by a biometrically verified human on tamper-proof hardware.

## Hardware Components

### Main Controller
- **MCU:** ESP32-S3-WROOM-1 (dual-core Xtensa LX7, 240 MHz)
  - Native USB OTG (USB HID keyboard + custom attestation endpoint)
  - 512 KB SRAM, 8 MB PSRAM
  - Hardware AES, SHA, RSA acceleration
  - Secure boot V2 and flash encryption support
  - 45 GPIOs (sufficient for key matrix + I2C + SPI peripherals)
  - Wi-Fi 802.11 b/g/n and BLE 5.0 integrated

### Secure Element
- **Chip:** ATECC608B (Microchip)
  - I2C interface (default address 0x60, up to 1 MHz)
  - Hardware Ed25519 key generation and signing (via NIST P-256 internally; Ed25519 via CryptoAuth library or external conversion)
  - 16 key storage slots (slot 0 reserved for device attestation key)
  - Tamper-resistant: active metal shield, voltage/frequency monitors
  - Unique 72-bit serial number per chip
  - Monotonic counter for replay protection
  - ECDH key agreement for secure provisioning

### Fingerprint Sensor
- **Sensor:** FPC1025 capacitive fingerprint sensor
  - 160 x 160 pixel array, 508 DPI
  - SPI interface to ESP32-S3
  - Integrated into a dedicated palm-rest area or a widened spacebar keycap
  - Template storage: encrypted templates stored in ATECC608B slot 8
  - On-chip matching via FPC BEP (Biometric Evaluation Platform) library
  - Continuous capture mode during typing sessions

### Per-Key Capacitive Touch Sensors
- **Implementation:** Custom PCB with copper capacitive pads under each key switch
  - One pad per key position on a separate sensing layer
  - Measured via ESP32-S3 touch sensor peripheral (14 channels) + CD74HC4067 analog multiplexers
  - Each pad measures:
    - **Approach distance:** capacitance change as finger nears the key (pre-press)
    - **Touch area:** capacitance magnitude proportional to finger contact area
    - **Pressure proxy:** capacitance change during key depression
    - **Touch duration:** time from capacitance threshold to key switch actuation and release
  - Sampling rate: 1 kHz per active key (round-robin across multiplexer channels)
  - Resolution: 12-bit ADC (ESP32-S3 internal)

### Key Switches
- **Type:** Cherry MX compatible mechanical switches (hot-swap sockets)
- **Matrix:** Standard keyboard matrix (rows x columns) scanned by ESP32-S3 GPIOs
- **Special keys:**
  - `ATTEST` key: dedicated key (top-right area) with LED indicator (red/green)
  - `FINGERPRINT` key: optional dedicated key to trigger explicit fingerprint capture
- **Layout:** Standard ANSI 104-key or TKL 87-key

### Connectivity
- **Primary:** USB-C connector
  - USB 2.0 Full Speed (12 Mbps)
  - USB HID keyboard (boot protocol compatible)
  - USB HID custom report descriptor for attestation data output
  - USB CDC fallback for firmware updates
- **Secondary (optional):** BLE 5.0
  - BLE HID keyboard profile
  - Attestation data via custom BLE GATT service
  - UUID: `0xKW01` (KeyWitness attestation service)

### Power
- USB bus-powered (5V, 500 mA max)
- 3.3V LDO for ESP32-S3 and peripherals
- Optional: 2000 mAh LiPo battery for wireless operation
- Power consumption: ~150 mA active typing, ~250 mA during attestation signing

### PCB Design Notes
- 4-layer PCB: signal, ground, power, capacitive sense
- Capacitive sense layer: dedicated copper pour with guard traces
- ATECC608B placed near MCU with short I2C traces, decoupling capacitors
- FPC1025 connected via FPC ribbon cable to dedicated SPI bus
- ESD protection on USB-C lines (TVS diode array)

---

## Security Architecture

### Secure Boot Chain
1. ESP32-S3 ROM bootloader (immutable, in silicon)
2. ROM bootloader verifies second-stage bootloader signature (RSA-3072 or ECDSA)
3. Second-stage bootloader verifies application firmware signature
4. Flash encryption enabled (AES-256-XTS) to prevent firmware extraction
5. JTAG permanently disabled via eFuse after provisioning
6. Key revocation: up to 3 signing key rotations via eFuse key slots

### Secure Element Key Architecture
| Slot | Purpose | Key Type | Access Policy |
|------|---------|----------|---------------|
| 0 | Device attestation signing key | P-256 (ECDSA) | Sign only, never exportable |
| 1 | Device attestation public key | P-256 public | Read-only |
| 2 | Provisioning key (factory) | P-256 | ECDH only, locked after provisioning |
| 3 | Firmware update verification | P-256 public | Read-only |
| 4-7 | Reserved | - | Locked |
| 8 | Fingerprint template (encrypted) | AES-128 data | Encrypted read/write |
| 9 | Monotonic counter | Counter | Increment only |
| 10-15 | Reserved | - | Locked |

### Key Material Lifecycle
1. **Factory provisioning:** Device attestation keypair generated on-chip (slot 0/1). Public key extracted and registered with KeyWitness certificate authority.
2. **User enrollment:** Fingerprint enrolled locally, template encrypted and stored in slot 8. Enrollment requires physical button hold to prevent remote enrollment.
3. **Runtime:** Private key never leaves ATECC608B. All signing operations happen inside the secure element.
4. **Decommission:** Secure erase command zeros all slots and increments counter to max.

### Keystroke Data Integrity
- Each keystroke event includes: key code, timestamp (ms), capacitive sensor values (approach, touch, pressure, duration)
- Keystroke events are buffered in ESP32-S3 PSRAM in a rolling window (last 4096 keystrokes)
- Buffer is protected by HMAC (key derived from secure element) to detect tampering
- On attestation, the buffer is hashed (SHA-256) and included in the signed payload

### Fingerprint Security
- Fingerprint matching runs on ESP32-S3 using FPC BEP library
- Raw fingerprint images are never stored; only minutiae templates
- Templates are encrypted with AES key from ATECC608B before storage
- Match threshold: FAR < 1/50,000 (configurable)
- Liveness detection via capacitive sensing (detects fake fingers by dielectric properties)

---

## What This CAN Attest (vs iOS Keyboard)

Everything the iOS software keyboard can attest, PLUS:

| Capability | iOS Keyboard | KeyWitness Hardware |
|-----------|-------------|-------------------|
| Text was typed sequentially | Yes | Yes |
| Keystroke timing patterns | Yes (touchscreen) | Yes (mechanical + capacitive) |
| Device identity | Yes (Secure Enclave) | Yes (ATECC608B serial) |
| Firmware integrity | Partial (OS-level) | Yes (secure boot chain) |
| **Fingerprint match** | No | **Yes** - proves a specific enrolled finger was present during typing |
| **Hardware integrity** | No | **Yes** - secure boot proves firmware has not been tampered with |
| **Physical key press verification** | No | **Yes** - capacitive sensors prove physical finger contact, not software injection |
| **Per-key biometrics** | No | **Yes** - capacitive touch patterns (area, pressure, approach) are harder to spoof than touchscreen |
| **Anti-injection** | Partial | **Strong** - capacitive data must correlate with key matrix events |
| **Replay protection** | Timestamp | **Monotonic counter** + timestamp |

### Key Advantage: Physical Contact Proof
The per-key capacitive sensors create a "physical presence proof" for each keystroke. Software-injected keystrokes (via USB, driver, or firmware compromise) would lack corresponding capacitive sensor data. The attestation includes a hash of this sensor data, allowing verifiers to check that physical contact occurred.

---

## What This CANNOT Attest

- **Identity beyond fingerprint:** Fingerprints can be spoofed with sufficient effort (lifted prints, silicone molds). The keyboard proves "an enrolled fingerprint was present" not "a specific person was present."
- **Coercion/duress:** The keyboard cannot detect whether the user is typing under threat. (Future: a duress key could signal this, but it is trivially defeated by an informed coercer.)
- **Screen content:** The keyboard has no knowledge of what is displayed on the screen. The user may be typing in response to something the keyboard cannot see.
- **Comprehension/intent:** The keyboard cannot verify that the user understood or intended the meaning of what they typed. They may be copying dictated text.
- **Network context:** The keyboard does not know where the text will be sent or how it will be used after attestation.
- **Environmental context:** No camera, microphone, or ambient sensors. No proof of physical location or surroundings.
- **Multi-user disambiguation:** If multiple people have enrolled fingerprints, the attestation proves "one of the enrolled users" typed, not which one (unless fingerprint slot IDs are included).

---

## Attestation Flow

### Step-by-Step

```
1. USER TYPES NORMALLY
   - Key matrix scan detects key press/release
   - Capacitive sensor captures touch data per keystroke
   - Firmware records: {keycode, timestamp_ms, cap_approach, cap_touch, cap_pressure, cap_duration}
   - Keystroke buffer accumulates in PSRAM

2. FINGERPRINT CAPTURE (continuous)
   - FPC1025 captures fingerprint periodically (every 2 seconds) or on FINGERPRINT key press
   - BEP library extracts minutiae and matches against enrolled template
   - Match result stored: {matched: bool, confidence: u8, last_match_timestamp: u64}

3. USER PRESSES "ATTEST" KEY
   - ATTEST key LED turns yellow (processing)
   - Firmware freezes keystroke buffer

4. FIRMWARE BUILDS ATTESTATION PAYLOAD
   - Extracts cleartext from keystroke buffer (keycodes -> UTF-8)
   - Computes SHA-256 hash of full capacitive sensor data stream
   - Reads device serial from ATECC608B
   - Reads monotonic counter and increments it
   - Reads RTC timestamp (or USB SOF-derived timestamp)
   - Constructs payload:
     {
       "version": 1,
       "device_serial": "0123AABB4567CCDD89",
       "counter": 42,
       "timestamp": 1700000000,
       "cleartext": "I agree to the terms",
       "sensor_data_hash": "a1b2c3...",
       "fingerprint_matched": true,
       "fingerprint_confidence": 92,
       "fingerprint_last_seen": 1699999998,
       "firmware_version": "1.0.0",
       "secure_boot_status": true
     }

5. SECURE ELEMENT SIGNS
   - Payload serialized to canonical CBOR (deterministic encoding)
   - SHA-256 hash of CBOR sent to ATECC608B
   - ATECC608B signs hash with slot 0 private key (ECDSA P-256)
   - Signature (64 bytes) returned to firmware

6. OUTPUT ATTESTATION BLOCK
   - Firmware constructs attestation block:
     -----BEGIN KEYWITNESS ATTESTATION-----
     <base64-encoded CBOR payload + signature>
     -----END KEYWITNESS ATTESTATION-----
   - Block is "typed" via USB HID as if the user typed it
   - ATTEST key LED turns green (success) for 2 seconds
   - Keystroke buffer is cleared
```

### Attestation Data Format (CBOR)

```
KW_Attestation = {
  1: uint,           ; version (1)
  2: bytes,          ; device_serial (9 bytes)
  3: uint,           ; monotonic_counter
  4: uint,           ; timestamp (Unix seconds)
  5: tstr,           ; cleartext (UTF-8)
  6: bytes,          ; sensor_data_hash (32 bytes, SHA-256)
  7: bool,           ; fingerprint_matched
  8: uint,           ; fingerprint_confidence (0-100)
  9: uint,           ; fingerprint_last_seen (Unix seconds)
  10: tstr,          ; firmware_version
  11: bool,          ; secure_boot_verified
  12: bytes,         ; signature (64 bytes, ECDSA P-256)
}
```

### Verification (by relying party)

1. Decode base64, parse CBOR
2. Extract signature (field 12), reconstruct payload without signature
3. Look up device public key by serial number from KeyWitness device registry
4. Verify ECDSA P-256 signature over SHA-256 of payload
5. Check monotonic counter is greater than last seen (replay protection)
6. Check timestamp is recent (freshness)
7. Check fingerprint_matched is true and confidence meets threshold
8. Check secure_boot_verified is true
9. Read cleartext - this is the attested text

---

## Bill of Materials (Estimated)

| Component | Part Number | Qty | Unit Cost (USD) |
|-----------|-------------|-----|-----------------|
| ESP32-S3-WROOM-1 | ESP32-S3-WROOM-1-N8R8 | 1 | $3.50 |
| ATECC608B | ATECC608B-MAHDA-S | 1 | $0.80 |
| FPC1025 fingerprint sensor | FPC1025 | 1 | $8.00 |
| Cherry MX switches | Various | 87 | $0.30 ea ($26.10) |
| USB-C connector | USB4110-GF-A | 1 | $0.50 |
| Analog multiplexers | CD74HC4067 | 6 | $0.60 ea ($3.60) |
| LDO regulator (3.3V) | AMS1117-3.3 | 1 | $0.30 |
| TVS diode array | PRTR5V0U2X | 1 | $0.20 |
| PCB (4-layer) | Custom | 1 | $15.00 |
| Keycaps | PBT doubleshot | 87 | $0.15 ea ($13.05) |
| Enclosure | CNC aluminum | 1 | $25.00 |
| Misc (passives, connectors, LED) | Various | - | $5.00 |
| **Total** | | | **~$101.05** |

---

## Development Phases

### Phase 1: Proof of Concept
- ESP32-S3 DevKitC + breadboard
- 4-key macro pad with capacitive sense pads
- ATECC608B breakout board (I2C)
- USB HID keyboard output
- Basic attestation signing

### Phase 2: Prototype
- Custom PCB (TKL layout)
- Integrated FPC1025
- Full key matrix + capacitive sensing
- Secure boot enabled
- Attestation output via USB HID

### Phase 3: Production
- Refined PCB (DFM optimized)
- CNC aluminum enclosure
- FCC/CE certification
- Key provisioning infrastructure
- Device registry backend
