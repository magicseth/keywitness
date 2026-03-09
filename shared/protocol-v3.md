# KeyWitness Attestation Protocol v3

Version: 3 (W3C Verifiable Credentials 2.0)

## Overview

Protocol v3 restructures KeyWitness attestations as W3C Verifiable Credentials
2.0 with Data Integrity proofs. This enables any VC-compatible verifier to
parse and verify attestations without KeyWitness-specific code.

v1 and v2 attestations continue to verify correctly. The PEM transport format
and short URL distribution are unchanged.

---

## 1. Credential Format

A v3 attestation is a W3C VC 2.0 JSON document:

```json
{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://keywitness.io/ns/v1"
  ],
  "type": ["VerifiableCredential", "KeyWitnessAttestation"],
  "issuer": "did:key:z6MkptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8",
  "validFrom": "2026-03-09T04:07:41.132Z",
  "credentialSubject": {
    "type": "HumanTypedContent",
    "cleartextHash": "J34ge8Q-7YwT...",
    "encryptedCleartext": "wEjPIBThYE7Y...",
    "deviceId": "4BF95BEA-F75E-...",
    "keystrokeBiometricsHash": "A_o4L8hOYKZN...",
    "faceIdVerified": false
  },
  "publicKey": "ptkiFsmaK4kJ...",
  "proof": [
    {
      "type": "DataIntegrityProof",
      "cryptosuite": "eddsa-jcs-2022",
      "created": "2026-03-09T04:07:41.132Z",
      "verificationMethod": "did:key:z6Mk...#z6Mk...",
      "proofPurpose": "assertionMethod",
      "proofValue": "z4vMhfJ...",
      "proofType": "keystrokeAttestation"
    },
    {
      "type": "AppleAppAttestProof",
      "created": "2026-03-09T04:07:41.132Z",
      "keyId": "base64url-app-attest-key-id",
      "assertionData": "base64url-cbor-assertion",
      "clientData": "cleartext-hash:device-id:timestamp",
      "proofType": "deviceAttestation"
    }
  ]
}
```

---

## 2. Contexts

### W3C VC 2.0 Context
`https://www.w3.org/ns/credentials/v2`

### KeyWitness Context
`https://keywitness.io/ns/v1`

Defines custom terms:
- `KeyWitnessAttestation` — credential type
- `HumanTypedContent` — credential subject type
- `cleartextHash`, `encryptedCleartext`, `deviceId`, `keystrokeBiometricsHash`
- `AppleAppAttestProof`, `keystrokeAttestation`, `biometricVerification`, `deviceAttestation`

---

## 3. Issuer Identity (did:key)

The issuer is identified by a `did:key` — a self-resolving DID derived from
the Ed25519 public key:

```
did:key:z<base58btc(0xed01 || raw_32_byte_public_key)>
```

No registry, blockchain, or resolution service needed. The public key is
embedded in the DID itself.

For backward compatibility, the raw base64url public key is also included as
`publicKey` at the credential root.

---

## 4. Signing (eddsa-jcs-2022)

### Algorithm

1. Build the credential object (everything except `proof`)
2. Canonicalize with RFC 8785 JCS → SHA-256 → `transformedDocumentHash`
3. Build proof options (everything in proof except `proofValue`)
4. Canonicalize proof options with JCS → SHA-256 → `proofOptionsHash`
5. Concatenate: `proofOptionsHash || transformedDocumentHash` (64 bytes)
6. Sign with Ed25519
7. Encode signature as multibase z (base58btc)
8. Set `proof.proofValue`

### Verification

Same algorithm in reverse:
1. Extract `proofValue` from proof
2. Decode multibase to get 64-byte signature
3. Reconstruct `proofOptionsHash || transformedDocumentHash`
4. Extract public key from `verificationMethod` (decode did:key)
5. Verify Ed25519 signature

---

## 5. Proof Types

### 5.1 Keystroke Attestation (`keystrokeAttestation`)

The primary proof. Proves the credential was signed by the Ed25519 key
that typed the content.

```json
{
  "type": "DataIntegrityProof",
  "cryptosuite": "eddsa-jcs-2022",
  "proofType": "keystrokeAttestation"
}
```

### 5.2 Biometric Verification (`biometricVerification`)

Added post-attestation when Face ID confirms the device owner. Signs the
same credential (minus existing proofs) with the same Ed25519 key.

```json
{
  "type": "DataIntegrityProof",
  "cryptosuite": "eddsa-jcs-2022",
  "proofType": "biometricVerification"
}
```

### 5.3 Device Attestation (`deviceAttestation`)

Apple App Attest proof. Contains the P-256 ECDSA assertion from
DCAppAttestService, proving the attestation originated from a genuine
Apple device running the real KeyWitness app.

```json
{
  "type": "AppleAppAttestProof",
  "keyId": "base64url-app-attest-key-id",
  "assertionData": "base64url-cbor-assertion",
  "proofType": "deviceAttestation"
}
```

Server-side verification:
- The assertion is verified during upload against stored P-256 credentials
- Counter tracking prevents replay attacks
- `serverVerified: true` indicates server validated the assertion

---

## 6. Version Detection

```typescript
function detectVersion(payload: Record<string, unknown>): "v1" | "v2" | "v3" {
  if (payload["@context"]) return "v3";
  if (payload.cleartextHash) return "v2";
  return "v1";
}
```

All three versions verify correctly. New attestations use v3.

---

## 7. Transport Format

Same PEM-style armored block as v1/v2:

```
-----BEGIN KEYWITNESS ATTESTATION-----
<base64url-encoded VC JSON>
-----END KEYWITNESS ATTESTATION-----
```

Distribution via short URLs with encryption key in fragment:
```
https://keywitness.io/v/abc123#<base64url-aes-key>
```

---

## 8. Multi-Provider Extensibility

Third-party providers (e.g., TypeProof hardware keyboards) can issue
compatible credentials by:

1. Using `did:key` for their signing identity
2. Including the W3C VC 2.0 context
3. Adding their own context URL for custom terms
4. Using `eddsa-jcs-2022` for the primary proof

The KeyWitness verifier recognizes any VC with `VerifiableCredential` type
and validates all Data Integrity proofs using standard algorithms.

Provider metadata is published at:
```
https://keywitness.io/.well-known/keywitness-providers.json
```

---

## 9. Ecosystem Integration

### Nostr (NIP-05)
```
GET https://keywitness.io/.well-known/nostr.json?name=<username>
```

### Bluesky (AT Protocol Labeler)
```
POST https://keywitness.io/api/labeler/verify
```

### C2PA
```
GET https://keywitness.io/api/c2pa?id=<shortId>
```

### EAT (RFC 9711)
```
GET https://keywitness.io/api/eat?id=<shortId>
```

---

## 10. Backward Compatibility

| Feature | v1 | v2 | v3 |
|---|---|---|---|
| Cleartext | In payload | Encrypted (AES-GCM) | Encrypted (AES-GCM) |
| Canonical format | Fixed key order | Sorted keys | RFC 8785 JCS |
| Key identifier | Raw base64url | Raw base64url | did:key + raw base64url |
| Proof format | Single signature field | Single signature field | VC proof array |
| Device attestation | Optional token field | Optional token field | Proof in array |
| Biometric proof | Not in payload | Not in payload | Proof in array |
| VC compatible | No | No | Yes |
