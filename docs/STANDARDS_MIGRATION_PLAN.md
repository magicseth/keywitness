# KeyWitness Standards Migration Plan

## Executive Summary

KeyWitness supports three attestation format versions: v1 (cleartext), v2 (encrypted),
and v3 (W3C Verifiable Credentials 2.0 with `eddsa-jcs-2022`). All five migration
phases have been implemented. This document serves as both the original migration plan
and a record of what was built.

The goal: any VC-compatible verifier can parse and verify a KeyWitness attestation
without custom code, and third-party attestation providers (other keyboards,
hardware security modules, biometric providers) can issue compatible credentials.

---

## Current Architecture

### What We Have Today

| Component | Current Implementation |
|---|---|
| Signing algorithm | Ed25519 (CryptoKit on iOS, tweetnacl on web) |
| Key format | Raw base64url-encoded 32-byte public key |
| Canonical payload | Hand-rolled sorted-key JSON (manual string concat on iOS, `JSON.stringify` of sorted keys on web) |
| Transport format | PEM-style `-----BEGIN KEYWITNESS ATTESTATION-----` block |
| Distribution | Short URLs with encryption key in fragment: `keywitness.io/v/abc123#key` |
| Encryption | AES-256-GCM client-side, key in URL fragment (zero-knowledge server) |
| Biometric proof | Post-attestation Face ID via notification → server-stored signature |
| Device attestation | Apple App Attest ✅ (implemented — see "Current App Attest Implementation" below) |
| Key registry | Convex database with name + publicKey |

### Protocol Versions

- **v1** (`version: 1`): Cleartext in payload, hex-encoded biometrics hash, fixed field order
- **v2** (`keywitness-v2`): Cleartext encrypted (AES-GCM), `cleartextHash` + `encryptedCleartext` in payload, alphabetically sorted keys, `faceIdVerified` flag

### Current App Attest Implementation (Completed)

Apple App Attest is fully implemented as a pre-VC server-verified system:

**iOS — Main App (`AppAttestManager.swift`)**
- Singleton `AppAttestManager` handles one-time key generation + attestation
- Flow: `DCAppAttestService.generateKey()` → fetch challenge from `POST /api/app-attest/challenge` → `attestKey(keyId, clientDataHash)` with Apple → verify attestation via `POST /api/app-attest/verify`
- Stores attested `keyId` in App Group shared `UserDefaults` so the keyboard extension can access it
- Called from `MainViewController.setupAppAttest()` on app launch

**iOS — Keyboard Extension (`AppAttestHelper.swift`)**
- Lightweight helper reads attested `keyId` from App Group
- Generates per-request assertions via `DCAppAttestService.generateAssertion(keyId, clientDataHash)`
- `KeyWitnessKeyboard.swift` calls `AppAttestHelper.shared.generateAssertion()` during attestation upload
- Passes `appAttestKeyId`, `appAttestAssertion`, `appAttestClientData` alongside the attestation payload

**Server — Convex Backend**
- `convex/appAttest.ts`:
  - `createChallenge` — generates random 32-byte challenge, stores in `appAttestChallenges` table
  - `verifyKeyAttestation` — one-time attestation: validates CBOR structure, `apple-appattest` format, RP ID hash (`SHA256("TCU64E3XV4.io.keywitness.app")`), counter=0, nonce binding via Apple OID `1.2.840.113635.100.8.2`, extracts P-256 credential public key, stores in `appAttestCredentials`
  - `verifyAssertion` (internal mutation) — per-request: ECDSA P-256 signature verification over `SHA256(authenticatorData || SHA256(clientData))`, counter increment for replay protection
- `convex/http.ts`:
  - `POST /api/app-attest/challenge` — creates challenge
  - `POST /api/app-attest/verify` — one-time key attestation
  - `POST /api/attestations` — verifies assertion inline if `appAttestKeyId`/`appAttestAssertion`/`appAttestClientData` present, sets `deviceVerified: true`
- `convex/schema.ts`:
  - `appAttestChallenges` table (challenge, createdAt, used; indexed by_challenge)
  - `appAttestCredentials` table (keyId, credentialPublicKey, linkedEd25519Key, counter, createdAt; indexed by_keyId, by_linkedEd25519Key)
  - `attestations` table includes `deviceVerified: optional(boolean)`

**Web — Verification UI (`Verify.tsx`)**
- "Device Attestation" section shows green badge when `deviceVerified` is true
- Shows yellow "App Attest present (not server-verified)" when `appAttestPresent` in the attestation payload but `deviceVerified` is false
- Shows gray "No device attestation" otherwise

**Key architectural note:** The current implementation stores App Attest verification as a server-side `deviceVerified` boolean on the attestation record. Phase 3.3 describes migrating this into the VC `proof` array so the device attestation proof is self-contained in the credential.

### Pain Points

1. Custom canonical JSON is fragile — hand-rolled on iOS, `JSON.stringify` on web, already caused a verification bug
2. No standard way for third parties to issue or verify attestations without our code
3. Public key has no standard identifier format
4. No formal credential type taxonomy
5. Biometric and device attestation proofs are stored server-side, not in the credential itself

---

## Target Architecture

### Standards Stack

| Layer | Standard | Specification |
|---|---|---|
| Credential format | W3C Verifiable Credentials 2.0 | [w3.org/TR/vc-data-model-2.0](https://www.w3.org/TR/vc-data-model-2.0/) |
| Signing / proof | W3C Data Integrity + EdDSA Cryptosuites | [w3.org/TR/vc-di-eddsa](https://www.w3.org/TR/vc-di-eddsa/) |
| Canonicalization | RFC 8785 JSON Canonicalization Scheme (JCS) | [rfc-editor.org/rfc/rfc8785](https://www.rfc-editor.org/rfc/rfc8785) |
| Key identifier | DID:key (self-resolving, no blockchain) | [w3c-ccg.github.io/did-method-key](https://w3c-ccg.github.io/did-method-key/) |
| Device attestation | Apple App Attest + FIDO metadata patterns | [developer.apple.com/documentation/devicecheck](https://developer.apple.com/documentation/devicecheck) |
| Content provenance | C2PA v2.2+ (future, for document embedding) | [spec.c2pa.org](https://spec.c2pa.org/) |

### What Stays the Same

- Ed25519 signing (same keys, same algorithm)
- PEM-style armored blocks as transport format
- Short URL distribution with encryption key in fragment
- AES-256-GCM client-side encryption
- Convex backend for storage and key registry
- Zero-knowledge server design

---

## Phase 1: Foundation (RFC 8785 + did:key)

**Effort:** Low | **Impact:** High | **Breaking:** No (new version, old versions still verified)

### 1.1 Adopt RFC 8785 for Canonicalization

Replace hand-rolled canonical JSON with JCS. This eliminates cross-platform
serialization bugs and is a prerequisite for Data Integrity compatibility.

**What JCS does differently from our current approach:**
- Normalizes number formatting (no trailing zeros, specific exponent rules)
- Normalizes Unicode escaping (only escape what JSON requires)
- Deterministic key ordering (alphabetical, same as what we do)
- Well-defined handling of special values

**iOS implementation:**
```swift
// Replace manual string concatenation in AttestationBuilder.canonicalSigningPayload()
// with a JCS-compliant serializer.
//
// Option A: Use a Swift JCS library (e.g. swift-json-canonicalization)
// Option B: Implement RFC 8785 — it's ~100 lines for the subset we need
//           (strings, numbers, booleans, objects — no arrays in signing payload)
```

**Web implementation:**
```typescript
// Replace JSON.stringify(sorted) with:
import canonicalize from "canonicalize"; // npm package, implements RFC 8785
const canonical = canonicalize(payload);
```

**Files to change:**
- `ios/KeyWitness/Keyboard/AttestationBuilder.swift` — `canonicalSigningPayload()`
- `web/src/lib/verify.ts` — `buildCanonicalPayload()`
- `shared/attestation.ts` — `buildSigningPayload()`

### 1.2 Adopt did:key for Public Key Identifiers

Wrap raw base64url public keys as `did:key:z6Mk...` identifiers. This is a
pure encoding change — the key bytes are identical, just wrapped in a
self-describing multicodec/multibase format.

**Encoding:** `did:key:` + multibase(multicodec(0xed, raw_public_key_bytes))
- `0xed` = Ed25519 public key multicodec prefix
- Multibase prefix `z` = base58btc encoding

**Example:**
```
Raw base64url: ptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8
did:key:       did:key:z6MkptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8
```

The `did:key` method is self-resolving — no registry or blockchain lookup needed.
Any DID resolver library can extract the raw public key bytes from the identifier.

**Backward compatibility:** Store both `publicKey` (raw base64url) and
`issuer` (did:key) in the attestation. Verifiers can use either.

**Files to change:**
- `ios/KeyWitness/Keyboard/CryptoEngine.swift` — add `publicKeyDIDKey()` method
- `ios/KeyWitness/Keyboard/AttestationBuilder.swift` — include `issuer` field
- `web/src/lib/verify.ts` — parse did:key to extract public key bytes
- `shared/attestation.ts` — add did:key encoding/decoding helpers

---

## Phase 2: Verifiable Credential Format

**Effort:** Medium | **Impact:** Very High | **Breaking:** New version (v3), old versions still verified

### 2.1 Restructure Attestation as W3C VC 2.0

The current flat JSON attestation becomes a Verifiable Credential. The PEM
block transport format stays the same — only the payload inside changes.

**Current v2 payload (inside PEM block):**
```json
{
  "version": "keywitness-v2",
  "cleartextHash": "J34ge8Q-7YwT...",
  "encryptedCleartext": "wEjPIBThYE7Y...",
  "deviceId": "4BF95BEA-F75E-...",
  "faceIdVerified": false,
  "timestamp": "2026-03-09T04:07:41.132Z",
  "keystrokeBiometricsHash": "A_o4L8hOYKZN...",
  "signature": "lKGije5g5wXp...",
  "publicKey": "ptkiFsmaK4kJ..."
}
```

**Proposed v3 payload (W3C VC 2.0):**
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
    "keystrokeBiometricsHash": "A_o4L8hOYKZN..."
  },
  "proof": {
    "type": "DataIntegrityProof",
    "cryptosuite": "eddsa-jcs-2022",
    "created": "2026-03-09T04:07:41.132Z",
    "verificationMethod": "did:key:z6MkptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8#z6MkptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8",
    "proofPurpose": "assertionMethod",
    "proofValue": "z<multibase-encoded-ed25519-signature>"
  }
}
```

**Key mapping from v2 → v3:**

| v2 field | v3 location | Notes |
|---|---|---|
| `version` | `@context` + `type` | Version encoded in context URL |
| `cleartext` / `cleartextHash` | `credentialSubject.cleartextHash` | Same semantics |
| `encryptedCleartext` | `credentialSubject.encryptedCleartext` | Same semantics |
| `deviceId` | `credentialSubject.deviceId` | Same semantics |
| `faceIdVerified` | Separate proof (Phase 3) | Moves out of signed payload |
| `timestamp` | `validFrom` + `proof.created` | Standard VC fields |
| `keystrokeBiometricsHash` | `credentialSubject.keystrokeBiometricsHash` | Same semantics |
| `signature` | `proof.proofValue` | Multibase-encoded |
| `publicKey` | `issuer` + `proof.verificationMethod` | did:key format |

### 2.2 Data Integrity Proof Generation (eddsa-jcs-2022)

The `eddsa-jcs-2022` cryptosuite defines exactly how to sign a JSON document:

1. **Remove the `proof` property** from the document
2. **Canonicalize** the document using RFC 8785 JCS
3. **Hash** the canonical form with SHA-256 → `transformedDocumentHash`
4. **Canonicalize** the `proof` object (minus `proofValue`) using JCS
5. **Hash** the canonical proof options with SHA-256 → `proofOptionsHash`
6. **Concatenate** `proofOptionsHash + transformedDocumentHash` (64 bytes)
7. **Sign** the concatenated hash with Ed25519
8. **Encode** the signature as multibase (base58btc, prefix `z`)
9. **Set** `proof.proofValue` to the multibase string

**This is the standard algorithm.** Libraries exist for most languages. On iOS
we implement it directly; on the web we can use the `@digitalbazaar/eddsa-jcs-2022-cryptosuite`
npm package or implement the ~50 lines of hash-then-sign ourselves.

**Files to change:**
- `ios/KeyWitness/Keyboard/AttestationBuilder.swift` — complete rewrite of payload construction
- `ios/KeyWitness/Keyboard/CryptoEngine.swift` — add multibase encoding, SHA-256 hash-then-sign
- `web/src/lib/verify.ts` — new verification path for v3 (keep v1/v2 paths)
- `shared/attestation.ts` — new types and verification for VC format
- `shared/protocol.md` — document v3 format

### 2.3 Publish JSON-LD Context

Host a JSON-LD context document at `https://keywitness.io/ns/v1` that defines
the custom terms:

```json
{
  "@context": {
    "KeyWitnessAttestation": "https://keywitness.io/ns/v1#KeyWitnessAttestation",
    "HumanTypedContent": "https://keywitness.io/ns/v1#HumanTypedContent",
    "cleartextHash": "https://keywitness.io/ns/v1#cleartextHash",
    "encryptedCleartext": "https://keywitness.io/ns/v1#encryptedCleartext",
    "deviceId": "https://keywitness.io/ns/v1#deviceId",
    "keystrokeBiometricsHash": "https://keywitness.io/ns/v1#keystrokeBiometricsHash"
  }
}
```

This enables any JSON-LD processor to understand KeyWitness attestation terms.
The context file is served as a static route from the Convex HTTP router.

**Files to change:**
- `web/convex/http.ts` — add route for `/ns/v1`
- `web/public/ns-v1.json` — the context document

### 2.4 Version Negotiation

The verifier determines the version from the decoded payload:

```typescript
function detectVersion(payload: any): "v1" | "v2" | "v3" {
  if (payload["@context"]) return "v3";  // VC 2.0
  if (payload.cleartextHash) return "v2"; // encrypted cleartext
  return "v1";                            // original format
}
```

All three versions continue to verify correctly. New attestations use v3.

---

## Phase 3: Multi-Proof Architecture

**Effort:** Medium | **Impact:** High | **Breaking:** No (additive)

### 3.1 Multiple Proofs on a Single Credential

W3C VC 2.0 supports a `proof` array. This lets us attach multiple independent
proofs to a single attestation:

```json
{
  "@context": ["https://www.w3.org/ns/credentials/v2", "https://keywitness.io/ns/v1"],
  "type": ["VerifiableCredential", "KeyWitnessAttestation"],
  "issuer": "did:key:z6Mk...",
  "validFrom": "2026-03-09T04:07:41.132Z",
  "credentialSubject": { ... },
  "proof": [
    {
      "type": "DataIntegrityProof",
      "cryptosuite": "eddsa-jcs-2022",
      "created": "2026-03-09T04:07:41.132Z",
      "verificationMethod": "did:key:z6Mk...#z6Mk...",
      "proofPurpose": "assertionMethod",
      "proofValue": "z...",
      "@context": "https://keywitness.io/ns/v1",
      "proofType": "keystrokeAttestation"
    },
    {
      "type": "DataIntegrityProof",
      "cryptosuite": "eddsa-jcs-2022",
      "created": "2026-03-09T04:07:55.000Z",
      "verificationMethod": "did:key:z6Mk...#z6Mk...",
      "proofPurpose": "assertionMethod",
      "proofValue": "z...",
      "@context": "https://keywitness.io/ns/v1",
      "proofType": "biometricVerification"
    },
    {
      "type": "AppleAppAttestProof",
      "created": "2026-03-09T04:07:41.132Z",
      "attestationObject": "<base64url App Attest attestation>",
      "keyId": "<base64url App Attest key ID>",
      "@context": "https://keywitness.io/ns/v1",
      "proofType": "deviceAttestation"
    }
  ]
}
```

### 3.2 Migrate Biometric Verification into the Credential

Currently biometric verification is stored as separate fields on the Convex
attestation record (`biometricSignature`, `biometricPublicKey`, `biometricTimestamp`).

In v3, the biometric verification becomes a second proof in the `proof` array.
When the user taps the notification and completes Face ID, the app:

1. Fetches the attestation from the server
2. Signs the credential (minus existing proofs) with the same Ed25519 key
3. Appends the new proof to the `proof` array
4. Updates the server record with the updated credential

The verification page shows each proof independently:
- Keystroke attestation proof: "Typed on device X at time Y"
- Biometric proof: "Device owner verified via Face ID, 8s after attestation"
- Device attestation proof: "Genuine Apple device via App Attest"

### 3.3 Migrate App Attest into the Credential

**Current state (✅ implemented):** App Attest works end-to-end as a server-side verification system. The iOS main app performs one-time key attestation with Apple, the keyboard extension generates per-request ECDSA assertions, and the Convex backend verifies assertions and sets `deviceVerified: true` on the attestation record. The proof is not embedded in the credential itself — it's a server-side flag.

**Future state (Phase 3.3):** The App Attest assertion becomes a proof in the VC `proof` array rather than a server-side boolean. This makes the device attestation self-verifiable without hitting the KeyWitness server.

**Migration path:**
1. Keep the existing server-side verification infrastructure (`appAttest.ts`, challenge/verify endpoints)
2. In v3 format, include the App Attest assertion data in the `proof` array as an `AppleAppAttestProof`
3. The server continues to verify assertions (for replay protection via counter tracking)
4. The `deviceVerified` boolean becomes redundant — verifiers check the proof array directly
5. Existing pre-v3 attestations retain `deviceVerified` for backward compatibility

**Files to change:**
- `ios/KeyWitness/Keyboard/AttestationBuilder.swift` — multi-proof support, embed assertion in VC
- `ios/KeyWitness/KeyWitness/MainViewController.swift` — append biometric proof to credential
- `web/src/lib/verify.ts` — verify each proof independently (including P-256 App Attest proofs)
- `web/src/pages/Verify.tsx` — render proof chain
- `web/convex/attestations.ts` — store updated credential with appended proofs
- `web/convex/schema.ts` — simplify (proofs are in the credential, not separate fields)
- `web/convex/appAttest.ts` — keep for server-side counter tracking, but verification also works client-side from the proof

---

## Phase 4: Multi-Provider Extensibility

**Effort:** High | **Impact:** Strategic | **Breaking:** No

### 4.1 Provider Registry

Publish a registry of known attestation providers at a well-known URL:

```
https://keywitness.io/.well-known/keywitness-providers.json
```

```json
{
  "providers": [
    {
      "id": "https://keywitness.io",
      "name": "KeyWitness iOS Keyboard",
      "type": "software-keyboard",
      "capabilities": ["keystroke-biometrics", "face-id", "app-attest"],
      "signingAlgorithm": "Ed25519",
      "didMethod": "did:key",
      "proofTypes": ["keystrokeAttestation", "biometricVerification", "deviceAttestation"],
      "verificationEndpoint": "https://keywitness.io/v/{id}",
      "contextUrl": "https://keywitness.io/ns/v1"
    },
    {
      "id": "https://typeproof.tech",
      "name": "TypeProof Hardware Keyboard",
      "type": "hardware-keyboard",
      "capabilities": ["keystroke-biometrics", "fingerprint", "secure-element", "capacitive-touch"],
      "signingAlgorithm": "Ed25519",
      "didMethod": "did:key",
      "proofTypes": ["keystrokeAttestation", "fingerprintVerification", "hardwareAttestation"],
      "contextUrl": "https://typeproof.tech/ns/v1"
    }
  ]
}
```

Third-party providers register by submitting their metadata. The registry is
informational — verification works without it (proofs are self-contained) —
but it enables richer UI ("This attestation was produced by a TypeProof
hardware keyboard with fingerprint verification").

### 4.2 Provider-Specific Credential Subjects

Each provider can define its own `credentialSubject` properties via its own
JSON-LD context. The core KeyWitness context defines the shared terms:

- `cleartextHash` — SHA-256 of the typed text
- `encryptedCleartext` — AES-GCM ciphertext
- `deviceId` — opaque device identifier
- `keystrokeBiometricsHash` — hash of timing/position data

A hardware keyboard provider might add:
- `capacitiveTouchProfile` — per-key capacitance readings
- `secureElementSerial` — ATECC608B chip serial
- `firmwareVersion` — verified via secure boot

These additional properties don't break existing verifiers — they're simply
ignored by verifiers that don't understand the provider's context.

### 4.3 Cross-Provider Verification

The verification page at `keywitness.io/v/{id}` should verify attestations
from any provider, not just KeyWitness iOS:

1. Parse the VC
2. Check `@context` to identify the provider
3. Look up provider metadata from the registry (optional, for UI enrichment)
4. Verify each proof in the `proof` array using standard Data Integrity verification
5. Display provider-specific information based on `credentialSubject` properties

**Files to change:**
- `web/convex/http.ts` — add `/.well-known/keywitness-providers.json` route
- `web/src/lib/verify.ts` — generic VC verification (not KeyWitness-specific)
- `web/src/pages/Verify.tsx` — provider-aware rendering

---

## Phase 5: Ecosystem Integrations

**Effort:** Variable | **Impact:** Strategic | **Breaking:** No

### 5.1 Nostr Integration (NIP-05 Key Discovery)

Publish KeyWitness public keys via DNS-based discovery:

```
GET https://keywitness.io/.well-known/nostr.json?name=magicseth
```

```json
{
  "names": {
    "magicseth": "<hex-encoded-nostr-pubkey>"
  },
  "keywitness": {
    "magicseth": {
      "ed25519": "ptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8",
      "did": "did:key:z6MkptkiFsmaK4kJNxvOMO03G7IcDMJW3yD0_ZlMPAYE9t8"
    }
  }
}
```

### 5.2 Bluesky / AT Protocol Labeler

KeyWitness could function as an AT Protocol labeler that marks posts as
"human-typed-verified":

1. User posts on Bluesky, includes KeyWitness attestation URL
2. KeyWitness labeler service detects the URL
3. Verifies the attestation
4. Issues a label: `keywitness-verified` on the post
5. Bluesky displays the label to other users

This requires registering as an AT Protocol labeler and running a service
that monitors the firehose for KeyWitness URLs.

### 5.3 C2PA Document Embedding

For documents (PDF, Office, EPUB), embed KeyWitness attestations as C2PA
assertions. C2PA v2.2+ supports text-based formats.

A C2PA manifest for a document would include:
```json
{
  "assertions": [
    {
      "label": "io.keywitness.attestation",
      "data": {
        "url": "https://keywitness.io/v/abc123#key",
        "credential": { /* the full VC */ }
      }
    }
  ]
}
```

### 5.4 IETF Entity Attestation Token (EAT) Profile

For machine-to-machine scenarios (APIs verifying that input was human-typed),
express KeyWitness attestations as EAT (RFC 9711) tokens:

- JWT format with standard EAT claims
- Custom claims for keystroke biometrics
- Defined profile: `tag:keywitness.io,2026:eat-profile:v1`

This is complementary to VC 2.0 — same data, different serialization optimized
for API consumption vs human verification.

---

## Implementation Order and Dependencies

```
ALL PHASES IMPLEMENTED ✅

Phase 1.1: RFC 8785 JCS ──────────────┐  ✅ JCS.swift, canonicalize npm
Phase 1.2: did:key ────────────────────┤  ✅ DIDKey.swift, didkey.ts
                                       ▼
Phase 2.1: VC 2.0 payload format ──────┤  ✅ VCBuilder.swift, vc.ts
Phase 2.2: eddsa-jcs-2022 proofs ──────┤  ✅ sign + verify
Phase 2.3: JSON-LD context ────────────┤  ✅ /ns/v1 route + ns-v1.json
Phase 2.4: Version negotiation ────────┘  ✅ detectVersion() in verify.ts + vc.ts
                                       │
                                       ▼
Phase 3.1: Multi-proof array ──────────┤  ✅ ProofChain in Verify.tsx
Phase 3.2: Biometric proof in VC ──────┤  ✅ server-side + VC proof type
Phase 3.3: App Attest proof in VC ─────┘  ✅ AppleAppAttestProof in VC
                                       │
                                       ▼
Phase 4.1: Provider registry ──────────┤  ✅ /.well-known/keywitness-providers.json
Phase 4.2: Custom credential subjects ─┤  ✅ JSON-LD context supports extensibility
Phase 4.3: Cross-provider verification ┘  ✅ Generic VC verification in vc.ts
                                       │
                                       ▼
Phase 5.1: Nostr NIP-05 ──────────────┤  ✅ /.well-known/nostr.json
Phase 5.2: Bluesky labeler ────────────┤  ✅ /api/labeler/verify
Phase 5.3: C2PA assertions ────────────┤  ✅ /api/c2pa?id=
Phase 5.4: EAT tokens ────────────────┘  ✅ /api/eat?id=
                                       │
                                       ▼
Phase 6.1: BitstringStatusList ────────┤  ✅ /credentials/status, trust.ts
Phase 6.2: Trust registry ────────────┤  ✅ /api/trust/* endpoints
Phase 6.3: Verifier trust warnings ───┤  ✅ Verify.tsx trust banner
Phase 6.4: iOS version pinning ───────┤  ✅ upload response + VCBuilder
Phase 6.5: credentialStatus in VCs ───┘  ✅ VCBuilder.swift + vc.ts types
```

### Estimated Scope

| Phase | iOS Changes | Web Changes | Backend Changes | New Files | Status |
|---|---|---|---|---|---|
| 1.1 | JCS.swift | verify.ts (JCS fallback), shared/attestation.ts | None | `ios/.../JCS.swift`, `canonicalize` npm | **✅ Done** |
| 1.2 | DIDKey.swift, CryptoEngine | didkey.ts, verify.ts, shared/attestation.ts | None | `ios/.../DIDKey.swift`, `web/src/lib/didkey.ts` | **✅ Done** |
| 2.1-2.4 | VCBuilder.swift, AttestationBuilder | vc.ts, verify.ts (v3 path), Verify.tsx | http.ts (context route) | `ios/.../VCBuilder.swift`, `web/src/lib/vc.ts`, `ns-v1.json`, `protocol-v3.md` | **✅ Done** |
| 3.1 | VCBuilder (proof array) | vc.ts (multi-proof verify), Verify.tsx (ProofChain) | attestations.ts | None | **✅ Done** |
| 3.2 | MainViewController | verify.ts, Verify.tsx | attestations.ts, schema.ts | None | **✅ Done** (server-side + VC proof ready) |
| 3.3 | VCBuilder (AppAttestProof) | vc.ts (verifyAppAttestProof), Verify.tsx | appAttest.ts, http.ts, schema.ts | AppAttestManager.swift, AppAttestHelper.swift, appAttest.ts | **✅ Done** (server-side + VC proof) |
| 4.1-4.3 | None | Verify.tsx (provider-aware) | http.ts (providers endpoint) | `keywitness-providers.json` | **✅ Done** |
| 5.1 | None | None | http.ts (NIP-05 route) | None | **✅ Done** |
| 5.2 | None | None | http.ts (labeler route) | None | **✅ Done** |
| 5.3 | None | None | http.ts (C2PA route) | None | **✅ Done** |
| 5.4 | None | None | http.ts (EAT route) | None | **✅ Done** |
| 6.1 | None | None | trust.ts, attestations.ts, http.ts, schema.ts | None | **✅ Done** |
| 6.2 | None | None | trust.ts, http.ts, schema.ts | None | **✅ Done** |
| 6.3 | None | Verify.tsx (trust banner), verify.ts (TrustStatus type) | None | None | **✅ Done** |
| 6.4 | VCBuilder.swift (appVersion, credentialStatus) | None | http.ts (upload response) | None | **✅ Done** |
| 6.5 | VCBuilder.swift (credentialStatus) | vc.ts (types) | None | None | **✅ Done** |

---

## Backward Compatibility Strategy

1. **Version detection** is based on payload structure, not an explicit version field
2. **v1 and v2 attestations continue to verify** — the web verifier maintains all three code paths
3. **The PEM block format stays** — it's the user-facing transport, unchanged across versions
4. **URLs stay the same** — `keywitness.io/v/{id}#key` works for all versions
5. **New features are additive** — multi-proof, provider metadata, ecosystem integrations don't break existing attestations
6. **The server stores the raw PEM block** — no server-side migration needed. Old attestations are already in the database and continue to work

---

## Phase 6: Trust, Revocation & Version Pinning

**Effort:** Medium | **Impact:** High | **Breaking:** No (additive)

### 6.1 BitstringStatusList (W3C Recommendation)

Credential-level revocation using [W3C BitstringStatusList v1.0](https://www.w3.org/TR/vc-bitstring-status-list/).
Each attestation receives a `statusIndex` during upload. The status list is a 131,072-bit bitstring
(16KB, the W3C minimum) served as a `BitstringStatusListCredential` at `/credentials/status?id=1`.

**Credential format:**
```json
{
  "credentialStatus": {
    "id": "https://keywitness.io/credentials/status?id=1#42",
    "type": "BitstringStatusListEntry",
    "statusPurpose": "revocation",
    "statusListIndex": "42",
    "statusListCredential": "https://keywitness.io/credentials/status?id=1"
  }
}
```

**Implementation:**
- `convex/trust.ts` — `createStatusList`, `allocateStatusIndex`, `setStatusBit`, `checkStatusBit`, `revokeAttestation`
- `convex/attestations.ts` — allocates `statusIndex` during upload
- `convex/http.ts` — `GET /credentials/status?id=` serves W3C-format `BitstringStatusListCredential`
- `convex/schema.ts` — `statusLists` table (listId, statusPurpose, encodedList, nextIndex)

### 6.2 Server-Side Trust Registry

A trust management layer for keys, app versions, and providers, exposed via REST API.

**App version trust / forced upgrade (Signal pattern):**
- `setAppVersionTrust(version, trusted)` — explicitly mark versions as trusted/revoked
- `setMinimumAppVersion(version)` — forced upgrade: iOS app checks on upload, server returns `minimumVersion` in upload response
- `isAppVersionTrusted(version)` — permissive by default (trusted unless explicitly revoked)

**Provider trust:**
- `addProvider(providerId, name, proofTypes, signingAlgorithms, ...)` — register trusted attestation providers
- `revokeProvider(providerId, reason)` — revoke trust (with audit trail in `revocations` table)
- `getProviders()` — list active providers (non-expired, non-revoked)

**Key revocation:**
- `revokeKey(type, identifier, reason)` — revoke an Ed25519 key or App Attest credential
- `unrevokeKey(identifier)` — escape hatch for accidental revocations
- `isRevoked(identifier)` — check revocation status

**Composite query:**
- `getTrustStatus(publicKey?, appAttestKeyId?, appVersion?, providerId?)` — single query returning key revocation, credential revocation, version trust, provider trust, and minimum version

**API endpoints:**
- `GET /api/trust/status?publicKey=&appVersion=` — composite trust check
- `GET /api/trust/minimum-version` — forced upgrade check
- `GET /api/trust/revocations?type=` — list revocations
- `GET /api/trust/providers` — DB-backed provider list

### 6.3 Verifier Trust Warnings

The web verification page (`Verify.tsx`) fetches trust status from `/api/trust/status` after
cryptographic verification succeeds. Trust warnings are displayed as an orange banner between
the status banner and the detail fields, covering:
- Signing key revoked
- Device credential revoked
- App version no longer trusted

### 6.4 iOS Version Pinning

The upload response includes `minimumVersion` and `warnings`. The iOS app:
- Reads `minimumVersion` from the upload response
- Compares against `CFBundleShortVersionString`
- If below minimum, prompts user to update via App Store

The v3 credential includes `appVersion` in `credentialSubject` so verifiers can display the app version that produced the attestation.

### 6.5 credentialStatus in v3 VCs

The iOS `VCBuilder.swift` includes a `credentialStatus` field (BitstringStatusListEntry) in the VC
when a status index is available. The status index is received from the server during upload and
cached in `UserDefaults` for subsequent attestations.

**Schema additions:**
- `appVersions` — version trust records (version, bundleId, trusted, revokedAt, revocationReason)
- `appConfig` — global config (key-value, e.g. minimumAppVersion)
- `providerTrust` — dynamic provider registry (providerId, name, type, platform, proofTypes, ...)
- `revocations` — key/credential/provider revocations (type, identifier, reason, revokedAt, revokedBy)
- `statusLists` — BitstringStatusList storage (listId, statusPurpose, encodedList, nextIndex)

---

## Open Questions

1. **JCS library for Swift/iOS** — Does a production-ready RFC 8785 implementation exist for Swift, or do we implement it ourselves? The subset we need (objects with string/number/boolean values, no nested arrays) is small enough to implement in ~100 lines.

2. **Multibase encoding on iOS** — The Data Integrity spec uses multibase (base58btc with `z` prefix) for proof values. We need a base58 encoder for Swift. CryptoKit doesn't include one.

3. **JSON-LD processing** — Do we need a full JSON-LD processor, or is static context resolution sufficient? For our use case (known contexts, no remote context fetching), static resolution should be fine.

4. **Proof chain ordering** — When biometric/App Attest proofs are appended after the initial attestation, should the server re-serialize the full credential, or should appended proofs be stored separately and merged at verification time? Server-side merge is simpler but requires credential update; client-side merge keeps the server simpler.

5. **Key rotation** — did:key ties identity to a specific key. If a device key is compromised or rotated, how do we handle the transition? Options: did:web (domain-based, supports key rotation) or a KeyWitness-specific DID method.

6. **Privacy** — The `deviceId` in `credentialSubject` is a stable identifier that links all attestations from the same device. Should we offer an option to omit or randomize it for privacy-sensitive use cases?

---

## References

- [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C Data Integrity EdDSA Cryptosuites v1.0](https://www.w3.org/TR/vc-di-eddsa/)
- [W3C Verifiable Credential Data Integrity 1.0](https://www.w3.org/TR/vc-data-integrity/)
- [RFC 8785: JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
- [RFC 9711: Entity Attestation Token (EAT)](https://datatracker.ietf.org/doc/rfc9711/)
- [did:key Method Specification](https://w3c-ccg.github.io/did-method-key/)
- [C2PA Technical Specification v2.3](https://spec.c2pa.org/)
- [Apple App Attest Documentation](https://developer.apple.com/documentation/devicecheck)
- [Nostr NIP-05: DNS-Based Identity](https://github.com/nostr-protocol/nips/blob/master/05.md)
- [AT Protocol Labeling Service](https://docs.bsky.app/docs/advanced-guides/moderation)
- [Multibase Encoding](https://www.w3.org/TR/controller-document/#multibase-0)
- [Multicodec Table](https://github.com/multiformats/multicodec/blob/master/table.csv)
