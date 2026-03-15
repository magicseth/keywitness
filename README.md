# KeyWitness

Cryptographic proof of human input. Not detection — proof.

KeyWitness is an iOS keyboard that captures keystroke biometrics and builds [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model-2.0/) at the point of input. Every sealed message carries a self-contained cryptographic proof that it was typed by a human on a real device — verifiable by anyone, anywhere, without trusting us.

**[keywitness.io](https://keywitness.io)** · **[Humanifesto](https://keywitness.io/manifesto)** · **[How It Works](https://keywitness.io/how)** · **[Developer Docs](https://keywitness.io/developers)**

## What it proves

- **Human input** — Keystroke timing, touch position, contact radius, and pressure patterns unique to the typist
- **Real device** — Apple App Attest proves the keyboard runs on a genuine, non-jailbroken iPhone
- **Content integrity** — Ed25519 signature over the message, timestamps, and biometric hash
- **Owner confirmation** — Optional Face ID proof that the phone's owner saw and approved the message

## What it doesn't prove

Identity beyond the device, voluntariness, or originality of thought. It's proof of human input, not proof of identity or intent.

## Architecture

```
┌─────────────────────────────────────────────┐
│  iOS Keyboard Extension                      │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │Keystroke │  │  Crypto  │  │ App Attest │ │
│  │Capture   │→ │  Engine  │→ │  (P-256)   │ │
│  └─────────┘  └──────────┘  └────────────┘ │
│       ↓            ↓              ↓         │
│  ┌──────────────────────────────────────┐   │
│  │  W3C Verifiable Credential (v3)      │   │
│  │  eddsa-jcs-2022 + multi-proof        │   │
│  └──────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
        ↓ encrypted upload
┌─────────────────────────────────────────────┐
│  Convex Backend                              │
│  Stores encrypted blob it cannot read        │
│  Server never sees cleartext or private key  │
└─────────────────────────────────────────────┘
        ↓ link with emoji-encoded key
┌─────────────────────────────────────────────┐
│  Verification Website (React)                │
│  Client-side decryption + signature verify   │
│  No server trust required                    │
└─────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Signing | Ed25519 (CryptoKit iOS, tweetnacl web) |
| Credential | W3C VC 2.0 with eddsa-jcs-2022 |
| Canonicalization | RFC 8785 JCS |
| Identity | did:key (multicodec 0xed01 + base58btc) |
| Encryption | AES-256-GCM, key in URL fragment |
| Device attestation | Apple App Attest (P-256 ECDSA, CBOR) |
| Revocation | BitstringStatusList (W3C) |
| Backend | Convex |
| Frontend | React + Vite + Tailwind |

## Project Structure

```
ios/                  # iOS app + keyboard extension
  KeyWitness/
    Keyboard/         # Keyboard extension (keystroke capture, VC builder, crypto)
    KeyWitness/       # Main app (Face ID, App Attest, BLE)
web/                  # Website + backend
  src/                # React frontend (verification, embed SDK)
  convex/             # Convex backend (attestations, trust, usernames)
shared/               # Protocol specs
hardware/             # Hardware keyboard spec
docs/                 # Documentation
```

## Privacy

- Cleartext encrypted with AES-256-GCM before upload
- Encryption key lives in the URL fragment (never sent to server)
- Server stores an encrypted blob it cannot read
- Verification happens client-side in the browser
- No accounts, no tracking, no analytics

## Standards

Every piece is an open standard. Any conforming W3C VC verifier can validate KeyWitness credentials without knowing we exist.

- [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [eddsa-jcs-2022 Cryptosuite](https://www.w3.org/TR/vc-di-eddsa/)
- [did:key Method](https://w3c-ccg.github.io/did-method-key/)
- [BitstringStatusList](https://www.w3.org/TR/vc-bitstring-status-list/)
- [RFC 8785 JCS](https://datatracker.ietf.org/doc/html/rfc8785)

## Get the App

DM [@magicseth](https://x.com/magicseth) on X with "I'm a human" for a TestFlight invite.

## License

MIT
