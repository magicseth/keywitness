# KeyWitness Attestation Protocol

Version: 1

## Overview

KeyWitness is a cryptographic keyboard that attests text was typed on a specific
physical device with specific keystroke biometrics. Each piece of typed text
produces a signed **attestation** that can be independently verified by any
third party holding the signer's public key.

---

## 1. Attestation Format

An attestation is a JSON object with the following fields:

| Field                    | Type     | Required | Description |
|--------------------------|----------|----------|-------------|
| `version`                | `number` | yes      | Protocol version (currently `1`). |
| `cleartext`              | `string` | yes      | The text that was typed. |
| `deviceId`               | `string` | yes      | Opaque identifier for the device that produced the attestation. |
| `timestamp`              | `string` | yes      | ISO-8601 timestamp of when the text was finalized. |
| `keystrokeBiometricsHash`| `string` | yes      | Hex-encoded SHA-256 hash of the raw keystroke biometric data. |
| `appAttestToken`         | `string` | no       | Apple App Attest / Android key attestation token (base64url). Proves the attestation originated from a genuine KeyWitness app on genuine hardware. |
| `signature`              | `string` | yes      | Base64url-encoded Ed25519 signature over the canonical signing payload. |
| `publicKey`              | `string` | yes      | Base64url-encoded Ed25519 public key of the signing device. |

---

## 2. Signing Algorithm

**Ed25519** (RFC 8032) via the `tweetnacl` library.

- Key size: 32-byte public key, 64-byte secret key.
- Signature size: 64 bytes.
- All binary values in the JSON are encoded as **base64url** (RFC 4648 section 5,
  no padding).

---

## 3. Canonical Signing Payload

The signing payload is the UTF-8 encoding of a **deterministic JSON string**
constructed from the following fields in this exact key order:

```json
{
  "version": <number>,
  "cleartext": "<string>",
  "deviceId": "<string>",
  "timestamp": "<string>",
  "keystrokeBiometricsHash": "<string>"
}
```

If `appAttestToken` is present (non-null, non-undefined), it is included after
`keystrokeBiometricsHash`:

```json
{
  "version": <number>,
  "cleartext": "<string>",
  "deviceId": "<string>",
  "timestamp": "<string>",
  "keystrokeBiometricsHash": "<string>",
  "appAttestToken": "<string>"
}
```

The key order is fixed and must not be sorted alphabetically or reordered.
Implementations must build this JSON string by explicit concatenation or an
ordered serialization — never by relying on unspecified object key ordering.

The `signature` and `publicKey` fields are **never** part of the signed payload.

---

## 4. Verification Steps

Given an attestation object `A`:

1. **Parse** — Decode the attestation from its transport format (see section 6).
2. **Version check** — Confirm `A.version` is a supported version (currently `1`).
3. **Reconstruct payload** — Build the canonical signing payload from `A` as
   described in section 3.
4. **Decode signature** — Base64url-decode `A.signature` to obtain the raw
   64-byte signature.
5. **Decode public key** — Base64url-decode `A.publicKey` to obtain the raw
   32-byte public key.
6. **Ed25519 verify** — Verify the signature over the UTF-8 payload bytes using
   the public key. If verification fails, reject the attestation.
7. **(Optional) App Attest** — If `A.appAttestToken` is present, validate it
   against Apple/Google attestation services to confirm device authenticity.
8. **(Optional) Trust** — Confirm that `A.publicKey` belongs to a known/trusted
   device via an out-of-band trust establishment mechanism.

---

## 5. Security Guarantees

### What this protocol guarantees

- **Integrity** — Any modification to the cleartext, timestamp, device ID, or
  biometric hash after signing will cause verification to fail.
- **Authenticity** — A valid signature proves the holder of the corresponding
  private key produced the attestation.
- **Non-repudiation** — The signer cannot deny having produced the attestation
  (assuming the private key was not compromised).

### What this protocol does NOT guarantee

- **Identity** — The protocol does not bind a public key to a real-world human
  identity. Trust in the public key must be established out of band.
- **Typing fidelity** — The protocol attests that keystroke biometric data was
  hashed and included, but does not itself verify the biometric data matches a
  particular person. Biometric verification is the responsibility of the device.
- **Timestamp accuracy** — The timestamp is asserted by the device; it is not
  independently verified. A compromised device could lie about when text was
  typed.
- **Device integrity** — Without a valid `appAttestToken`, there is no proof
  that the signing software is the genuine KeyWitness app running on genuine
  hardware. The `appAttestToken` field exists to close this gap when available.
- **Confidentiality** — The cleartext is included in plaintext. Attestations
  should be treated as public documents.

---

## 6. Transport Format

For embedding in documents, messages, or clipboard transfer, attestations are
encoded as **armored text blocks**:

```
-----BEGIN KEYWITNESS ATTESTATION-----
<base64url-encoded JSON, no line wrapping>
-----END KEYWITNESS ATTESTATION-----
```

The base64url payload decodes to the full attestation JSON object (all fields
from section 1).

Multiple attestations may appear in the same document; each is enclosed in its
own BEGIN/END markers.
