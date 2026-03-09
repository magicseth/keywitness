/**
 * W3C VC 2.0 verification — server-side port.
 * Keep in sync with src/lib/vc.ts.
 */

import canonicalize from "canonicalize";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { decodeDIDKey } from "./didkey";

// ── Types ────────────────────────────────────────────────────────────────────

export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
  proofType?: "keystrokeAttestation" | "biometricVerification" | "voiceAttestation";
}

export interface AppleAppAttestProof {
  type: "AppleAppAttestProof";
  created: string;
  keyId: string;
  assertionData?: string;
  clientData?: string;
  proofType: "deviceAttestation";
  serverVerified?: boolean;
}

export type VCProof = DataIntegrityProof | AppleAppAttestProof;

export interface KeyWitnessCredentialSubject {
  type: "HumanTypedContent";
  cleartextHash: string;
  encryptedCleartext?: string;
  deviceId: string;
  keystrokeBiometricsHash: string;
  faceIdVerified?: boolean;
  appVersion?: string;
  keystrokeCount?: number;
  cleartextLength?: number;
}

export interface KeyWitnessVC {
  "@context": string[];
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: KeyWitnessCredentialSubject;
  proof: VCProof | VCProof[];
  publicKey?: string;
}

export interface ProofVerificationResult {
  proofType: string;
  valid: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export interface VCVerificationResult {
  valid: boolean;
  version: "v3";
  issuer: string;
  validFrom: string;
  credentialSubject: KeyWitnessCredentialSubject;
  proofs: ProofVerificationResult[];
  publicKey?: string;
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function multibaseDecode(encoded: string): Uint8Array {
  if (!encoded.startsWith("z")) throw new Error(`Unsupported multibase prefix: ${encoded[0]}`);
  return bs58.decode(encoded.slice(1));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

// ── Verification ──────────────────────────────────────────────────────────────

export async function verifyEddsaJcs2022(
  credential: KeyWitnessVC,
  proof: DataIntegrityProof,
): Promise<ProofVerificationResult> {
  try {
    const did = proof.verificationMethod.split("#")[0];
    const { keyType, publicKey: publicKeyBytes } = decodeDIDKey(did);
    if (keyType !== "Ed25519") {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: `Expected Ed25519, got ${keyType}` };
    }

    const { proof: _proof, ...credentialWithoutProof } = credential;
    void _proof;
    const canonicalDocument = canonicalize(credentialWithoutProof);
    if (!canonicalDocument) {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: "Failed to canonicalize document" };
    }
    const transformedDocumentHash = await sha256(new TextEncoder().encode(canonicalDocument));

    const { proofValue: _proofValue, ...proofOptions } = proof;
    void _proofValue;
    const canonicalProofOptions = canonicalize(proofOptions);
    if (!canonicalProofOptions) {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: "Failed to canonicalize proof options" };
    }
    const proofOptionsHash = await sha256(new TextEncoder().encode(canonicalProofOptions));

    const verifyData = new Uint8Array(64);
    verifyData.set(proofOptionsHash, 0);
    verifyData.set(transformedDocumentHash, 32);

    const signatureBytes = multibaseDecode(proof.proofValue);
    if (signatureBytes.length !== 64) {
      return { proofType: proof.proofType || "keystrokeAttestation", valid: false, error: `Invalid signature length: ${signatureBytes.length}` };
    }

    const valid = nacl.sign.detached.verify(verifyData, signatureBytes, publicKeyBytes);
    return {
      proofType: proof.proofType || "keystrokeAttestation",
      valid,
      error: valid ? undefined : "Ed25519 signature verification failed",
      details: { verificationMethod: proof.verificationMethod, created: proof.created },
    };
  } catch (err) {
    return {
      proofType: proof.proofType || "keystrokeAttestation",
      valid: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function verifyAppAttestProof(proof: AppleAppAttestProof): Promise<ProofVerificationResult> {
  if (proof.serverVerified) {
    return { proofType: "deviceAttestation", valid: true, details: { keyId: proof.keyId, verifiedBy: "server" } };
  }
  if (proof.assertionData) {
    return { proofType: "deviceAttestation", valid: true, details: { keyId: proof.keyId, verifiedBy: "server-at-upload" } };
  }
  return { proofType: "deviceAttestation", valid: false, error: "No assertion data and not server-verified" };
}

const VC_CONTEXT = "https://www.w3.org/ns/credentials/v2";

export async function verifyVC(credential: KeyWitnessVC): Promise<VCVerificationResult> {
  if (!credential["@context"]?.includes(VC_CONTEXT)) {
    return { valid: false, version: "v3", issuer: "", validFrom: "", credentialSubject: credential.credentialSubject, proofs: [], error: "Missing W3C VC 2.0 context" };
  }
  if (!credential.type?.includes("VerifiableCredential")) {
    return { valid: false, version: "v3", issuer: "", validFrom: "", credentialSubject: credential.credentialSubject, proofs: [], error: "Missing VerifiableCredential type" };
  }

  const proofs = Array.isArray(credential.proof) ? credential.proof : [credential.proof];
  const results: ProofVerificationResult[] = [];

  for (const proof of proofs) {
    if (proof.type === "DataIntegrityProof" && proof.cryptosuite === "eddsa-jcs-2022") {
      results.push(await verifyEddsaJcs2022(credential, proof));
    } else if (proof.type === "AppleAppAttestProof") {
      results.push(await verifyAppAttestProof(proof));
    } else {
      const unknownProof: { type?: string; proofType?: string } = proof;
      results.push({ proofType: unknownProof.proofType || "unknown", valid: false, error: `Unknown proof type: ${unknownProof.type}` });
    }
  }

  const primaryProof = results.find((r) => r.proofType === "keystrokeAttestation" || r.proofType === "voiceAttestation");
  const overallValid = primaryProof?.valid ?? false;

  let publicKey: string | undefined;
  try {
    const { publicKey: pkBytes } = decodeDIDKey(credential.issuer);
    let binary = "";
    for (let i = 0; i < pkBytes.length; i++) binary += String.fromCharCode(pkBytes[i]);
    publicKey = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    publicKey = credential.publicKey;
  }

  return { valid: overallValid, version: "v3", issuer: credential.issuer, validFrom: credential.validFrom, credentialSubject: credential.credentialSubject, proofs: results, publicKey };
}

export function detectVersion(payload: Record<string, unknown>): "v1" | "v2" | "v3" {
  if (payload["@context"]) return "v3";
  if (payload.cleartextHash) return "v2";
  return "v1";
}
