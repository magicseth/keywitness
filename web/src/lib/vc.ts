/**
 * W3C Verifiable Credentials 2.0 support for KeyWitness.
 *
 * Implements:
 * - VC 2.0 data model (credential structure, proof, multi-proof)
 * - eddsa-jcs-2022 Data Integrity cryptosuite (verification)
 * - Multi-proof verification (keystroke, biometric, device attestation)
 *
 * @module
 */

import canonicalize from "canonicalize";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { decodeDIDKey } from "./didkey";

// ── Constants ────────────────────────────────────────────────────────────────

export const KEYWITNESS_CONTEXT = "https://keywitness.io/ns/v1";
export const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string; // multibase z + base58btc
  /** KeyWitness-specific: what kind of proof this is */
  proofType?: "keystrokeAttestation" | "biometricVerification" | "voiceAttestation" | "photoAttestation";
}

export interface AppleAppAttestProof {
  type: "AppleAppAttestProof";
  created: string;
  keyId: string;
  assertionData?: string; // base64url CBOR assertion
  clientData?: string;
  proofType: "deviceAttestation";
  /** Server-verified flag for pre-migration attestations */
  serverVerified?: boolean;
}

export type VCProof = DataIntegrityProof | AppleAppAttestProof;

export interface KeyWitnessCredentialSubject {
  type: "HumanTypedContent" | "HumanSpokenContent" | "UnfilteredPhotograph";
  cleartextHash: string;
  encryptedCleartext?: string;
  deviceId: string;
  // Keystroke-specific
  keystrokeBiometricsHash?: string;
  keystrokeCount?: number;
  // Voice-specific
  audioHash?: string;
  faceMeshBiometricsHash?: string;
  audioMeshCorrelationScore?: number;
  inputSource?: string;
  audioDurationMs?: number;
  // Photo-specific
  imageHash?: string;
  exifHash?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFormat?: string;
  imageSizeBytes?: number;
  // Common
  faceIdVerified?: boolean;
  /** App version that created this attestation */
  appVersion?: string;
  cleartextLength?: number;
  /** Session challenge (e.g. BLE nonce) binding this VC to a specific session */
  challenge?: string;
}

/** W3C BitstringStatusListEntry for credential revocation */
export interface CredentialStatus {
  id: string;
  type: "BitstringStatusListEntry";
  statusPurpose: "revocation" | "suspension";
  statusListIndex: string;
  statusListCredential: string;
}

export interface KeyWitnessVC {
  "@context": string[];
  type: string[];
  issuer: string; // did:key
  validFrom: string; // ISO 8601
  credentialSubject: KeyWitnessCredentialSubject;
  credentialStatus?: CredentialStatus;
  proof: VCProof | VCProof[];
  /** Legacy compat: raw base64url public key */
  publicKey?: string;
}

/** Result of verifying a single proof in the proof array */
export interface ProofVerificationResult {
  proofType: string;
  valid: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

/** Full verification result for a v3 VC */
export interface VCVerificationResult {
  valid: boolean;
  version: "v3";
  issuer: string;
  validFrom: string;
  credentialSubject: KeyWitnessCredentialSubject;
  proofs: ProofVerificationResult[];
  publicKey?: string; // raw base64url for backward compat
  error?: string;
}

// ── Multibase helpers ────────────────────────────────────────────────────────

function multibaseEncode(bytes: Uint8Array): string {
  return `z${bs58.encode(bytes)}`;
}

function multibaseDecode(encoded: string): Uint8Array {
  if (!encoded.startsWith("z")) {
    throw new Error(`Unsupported multibase prefix: ${encoded[0]}`);
  }
  return bs58.decode(encoded.slice(1));
}

// ── SHA-256 helper ───────────────────────────────────────────────────────────

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

// ── eddsa-jcs-2022 Verification ──────────────────────────────────────────────

/**
 * Verify a Data Integrity proof using the eddsa-jcs-2022 cryptosuite.
 *
 * Algorithm (W3C VC Data Integrity EdDSA Cryptosuites v1.0):
 * 1. Remove `proof` from the document
 * 2. Canonicalize document with JCS → SHA-256 → transformedDocumentHash
 * 3. Remove `proofValue` from proof, canonicalize with JCS → SHA-256 → proofOptionsHash
 * 4. Concatenate proofOptionsHash + transformedDocumentHash (64 bytes)
 * 5. Verify Ed25519 signature over the concatenated hash
 */
export async function verifyEddsaJcs2022(
  credential: KeyWitnessVC,
  proof: DataIntegrityProof,
): Promise<ProofVerificationResult> {
  try {
    // 1. Extract the public key from the verification method
    const did = proof.verificationMethod.split("#")[0];
    const { keyType, publicKey: publicKeyBytes } = decodeDIDKey(did);
    if (keyType !== "Ed25519") {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: `Expected Ed25519, got ${keyType}` };
    }

    // 2. Remove proof from credential and canonicalize
    const { proof: _proof, ...credentialWithoutProof } = credential;
    void _proof;
    const canonicalDocument = canonicalize(credentialWithoutProof);
    if (!canonicalDocument) {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: "Failed to canonicalize document" };
    }
    const transformedDocumentHash = await sha256(new TextEncoder().encode(canonicalDocument));

    // 3. Remove proofValue from proof and canonicalize
    const { proofValue: _proofValue, ...proofOptions } = proof;
    void _proofValue;
    const canonicalProofOptions = canonicalize(proofOptions);
    if (!canonicalProofOptions) {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: "Failed to canonicalize proof options" };
    }
    const proofOptionsHash = await sha256(new TextEncoder().encode(canonicalProofOptions));

    // 4. Concatenate hashes
    const verifyData = new Uint8Array(64);
    verifyData.set(proofOptionsHash, 0);
    verifyData.set(transformedDocumentHash, 32);

    // 5. Decode signature from multibase
    const signatureBytes = multibaseDecode(proof.proofValue);
    if (signatureBytes.length !== 64) {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: `Invalid signature length: ${signatureBytes.length}` };
    }

    // 6. Verify Ed25519 signature
    const valid = nacl.sign.detached.verify(verifyData, signatureBytes, publicKeyBytes);

    return {
      proofType: proof.proofType || "keystrokeAttestation",
      valid,
      error: valid ? undefined : "Ed25519 signature verification failed",
      details: {
        verificationMethod: proof.verificationMethod,
        created: proof.created,
      },
    };
  } catch (err) {
    return {
      proofType: proof.proofType || "keystrokeAttestation",
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Verify an Apple App Attest proof.
 *
 * For v3 VCs, the App Attest assertion data is embedded in the proof.
 * Full cryptographic verification requires P-256 ECDSA — we check the
 * serverVerified flag for server-side verified proofs, or attempt
 * client-side verification if assertion data is present.
 */
export async function verifyAppAttestProof(
  proof: AppleAppAttestProof,
): Promise<ProofVerificationResult> {
  // Never trust the self-asserted serverVerified flag in the proof payload.
  // It's set by the attestation creator and can be forged. Device attestation
  // validity must be determined by server-side verification against stored
  // App Attest credentials (appAttestCredentials table lookup).

  // Assertion data is present but we cannot verify P-256 ECDSA client-side
  // (requires the stored credential public key from the server).
  // Do NOT mark as valid — assertionData alone is untrusted without
  // cryptographic verification against stored App Attest credentials.
  if (proof.assertionData) {
    return {
      proofType: "deviceAttestation",
      valid: false,
      error: "Client cannot verify App Attest assertion (requires server-side P-256 verification)",
      details: {
        keyId: proof.keyId,
        created: proof.created,
        hasAssertionData: true,
      },
    };
  }

  return {
    proofType: "deviceAttestation",
    valid: false,
    error: "No assertion data and not server-verified",
  };
}

// ── Multi-proof verification ─────────────────────────────────────────────────

/**
 * Verify all proofs on a VC 2.0 credential.
 */
export async function verifyVC(credential: KeyWitnessVC): Promise<VCVerificationResult> {
  // Validate basic structure
  if (!credential["@context"]?.includes(VC_CONTEXT)) {
    return {
      valid: false, version: "v3", issuer: "", validFrom: "",
      credentialSubject: credential.credentialSubject,
      proofs: [], error: "Missing W3C VC 2.0 context",
    };
  }

  if (!credential.type?.includes("VerifiableCredential")) {
    return {
      valid: false, version: "v3", issuer: "", validFrom: "",
      credentialSubject: credential.credentialSubject,
      proofs: [], error: "Missing VerifiableCredential type",
    };
  }

  const proofs = Array.isArray(credential.proof) ? credential.proof : [credential.proof];
  const results: ProofVerificationResult[] = [];

  for (const proof of proofs) {
    if (proof.type === "DataIntegrityProof" && proof.cryptosuite === "eddsa-jcs-2022") {
      results.push(await verifyEddsaJcs2022(credential, proof));
    } else if (proof.type === "AppleAppAttestProof") {
      results.push(await verifyAppAttestProof(proof));
    } else {
      // Defensive: handle unexpected proof types from future protocol versions
      const unknownProof: { type?: string; proofType?: string } = proof;
      results.push({
        proofType: unknownProof.proofType || "unknown",
        valid: false,
        error: `Unknown proof type: ${unknownProof.type}`,
      });
    }
  }

  // The credential is valid if the primary keystroke attestation proof is valid
  const primaryProof = results.find((r) => r.proofType === "keystrokeAttestation" || r.proofType === "voiceAttestation" || r.proofType === "photoAttestation");
  const overallValid = primaryProof?.valid ?? false;

  // SECURITY: Derive publicKey from the proof's verificationMethod (the actual signer),
  // NOT from credential.issuer. An attacker could set issuer to a victim's DID while
  // signing with their own key — the signature would verify but attribution would be wrong.
  let publicKey: string | undefined;
  let signerDID: string | undefined;
  const dataIntegrityProof = proofs.find(
    (p): p is DataIntegrityProof => p.type === "DataIntegrityProof" && (p as DataIntegrityProof).cryptosuite === "eddsa-jcs-2022"
  );
  if (dataIntegrityProof) {
    try {
      signerDID = dataIntegrityProof.verificationMethod.split("#")[0];
      const { publicKey: pkBytes } = decodeDIDKey(signerDID);
      let binary = "";
      for (let i = 0; i < pkBytes.length; i++) {
        binary += String.fromCharCode(pkBytes[i]);
      }
      publicKey = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    } catch {
      publicKey = credential.publicKey;
    }
  }

  // Verify issuer matches the actual signer — reject if they diverge
  if (overallValid && signerDID && credential.issuer !== signerDID) {
    return {
      valid: false,
      version: "v3",
      issuer: credential.issuer,
      validFrom: credential.validFrom,
      credentialSubject: credential.credentialSubject,
      proofs: results,
      publicKey,
      error: "Issuer DID does not match proof signer — possible impersonation attempt",
    };
  }

  return {
    valid: overallValid,
    version: "v3",
    issuer: credential.issuer,
    validFrom: credential.validFrom,
    credentialSubject: credential.credentialSubject,
    proofs: results,
    publicKey,
  };
}

// ── eddsa-jcs-2022 Signing (for tests and server-side) ──────────────────────

/**
 * Sign a credential using eddsa-jcs-2022.
 * Used for testing and for server-side biometric proof appending.
 */
export async function signEddsaJcs2022(
  credential: Omit<KeyWitnessVC, "proof">,
  secretKey: Uint8Array,
  options: {
    proofType?: "keystrokeAttestation" | "biometricVerification" | "voiceAttestation";
    created?: string;
  } = {},
): Promise<DataIntegrityProof> {
  const publicKey = secretKey.slice(32);
  const did = ed25519ToDIDKeyFromBytes(publicKey);
  const vmId = `${did}#${did.slice("did:key:".length)}`;

  const proof: Omit<DataIntegrityProof, "proofValue"> = {
    type: "DataIntegrityProof",
    cryptosuite: "eddsa-jcs-2022",
    created: options.created || new Date().toISOString(),
    verificationMethod: vmId,
    proofPurpose: "assertionMethod",
    ...(options.proofType ? { proofType: options.proofType } : {}),
  };

  // 1. Canonicalize document (without proof)
  const canonicalDocument = canonicalize(credential);
  if (!canonicalDocument) throw new Error("Failed to canonicalize document");
  const transformedDocumentHash = await sha256(new TextEncoder().encode(canonicalDocument));

  // 2. Canonicalize proof options (without proofValue)
  const canonicalProofOptions = canonicalize(proof);
  if (!canonicalProofOptions) throw new Error("Failed to canonicalize proof options");
  const proofOptionsHash = await sha256(new TextEncoder().encode(canonicalProofOptions));

  // 3. Concatenate and sign
  const signData = new Uint8Array(64);
  signData.set(proofOptionsHash, 0);
  signData.set(transformedDocumentHash, 32);

  const signature = nacl.sign.detached(signData, secretKey);

  return {
    ...proof,
    proofValue: multibaseEncode(signature),
  } as DataIntegrityProof;
}

// Helper to avoid circular import
function ed25519ToDIDKeyFromBytes(publicKey: Uint8Array): string {
  const prefix = new Uint8Array([0xed, 0x01]);
  const prefixed = new Uint8Array(prefix.length + publicKey.length);
  prefixed.set(prefix, 0);
  prefixed.set(publicKey, prefix.length);
  return `did:key:z${bs58.encode(prefixed)}`;
}

// ── Version detection ────────────────────────────────────────────────────────

/**
 * Detect attestation version from parsed payload.
 */
export function detectVersion(payload: Record<string, unknown>): "v1" | "v2" | "v3" {
  if (payload["@context"]) return "v3";
  if (payload.cleartextHash) return "v2";
  return "v1";
}
