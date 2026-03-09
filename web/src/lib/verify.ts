import nacl from "tweetnacl";
import canonicalize from "canonicalize";
import { detectVersion, verifyVC, type KeyWitnessVC, type VCVerificationResult, type ProofVerificationResult } from "./vc";
import { ed25519ToDIDKey } from "./didkey";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Attestation {
  version: string;
  cleartext?: string;           // v1 only
  cleartextHash?: string;       // v2+: base64url SHA-256 of cleartext
  encryptedCleartext?: string;  // v2+: base64url AES-GCM ciphertext
  deviceId: string;
  faceIdVerified?: boolean;
  timestamp: string;
  publicKey: string;
  signature: string;
  keystrokeBiometricsHash?: string;
  appAttestToken?: string;
}

export interface KeystrokeTiming {
  key: string;
  downAt: number;
  upAt: number;
  x?: number;
  y?: number;
  force?: number;
  radius?: number;
}

export interface TrustStatus {
  keyRevoked: boolean;
  keyRevocationReason?: string;
  credentialRevoked: boolean;
  credentialRevocationReason?: string;
  appVersionTrusted?: boolean;
  appVersionRevocationReason?: string;
  providerTrusted?: boolean;
  providerRevocationReason?: string;
  minimumVersion?: string;
}

export interface VerificationResult {
  valid: boolean;
  version?: "v1" | "v2" | "v3";
  cleartext?: string;
  deviceId?: string;
  faceIdVerified?: boolean;
  timestamp?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  issuerDID?: string;
  keystrokeBiometricsHash?: string;
  keystrokeTimings?: KeystrokeTiming[];
  appAttestPresent?: boolean;
  appVersion?: string;
  error?: string;
  encrypted?: boolean;
  decryptionFailed?: boolean;
  cleartextHash?: string;
  cleartextLength?: number;
  // v3 multi-proof results
  proofs?: ProofVerificationResult[];
  // Trust status (fetched separately after verification)
  trustStatus?: TrustStatus;
}

// ── Base64url helpers ────────────────────────────────────────────────────────

function base64urlDecode(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function decryptAESGCM(ciphertextB64: string, keyB64: string): Promise<string> {
  const ciphertextBytes = base64urlDecode(ciphertextB64);
  const keyBytes = base64urlDecode(keyB64);
  const nonce = ciphertextBytes.slice(0, 12);
  const rest = ciphertextBytes.slice(12);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonce), tagLength: 128 },
    key,
    toArrayBuffer(rest),
  );
  return new TextDecoder().decode(decrypted);
}

async function sha256Base64url(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return base64urlEncode(new Uint8Array(hash));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Fingerprint ──────────────────────────────────────────────────────────────

async function computeFingerprint(publicKeyBytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(publicKeyBytes),
  );
  const hex = bytesToHex(new Uint8Array(hash));
  return hex
    .slice(0, 32)
    .match(/.{2}/g)!
    .join(":");
}

// ── Canonical payload reconstruction (v1/v2) ────────────────────────────────

function buildCanonicalPayloadLegacy(attestation: Attestation): string {
  const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;
  const payload: Record<string, unknown> = {
    ...(isV2
      ? { cleartextHash: attestation.cleartextHash }
      : { cleartext: attestation.cleartext }),
    deviceId: attestation.deviceId,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash ?? "",
    timestamp: attestation.timestamp,
    version: attestation.version,
  };

  if (isV2 && attestation.encryptedCleartext) {
    payload.encryptedCleartext = attestation.encryptedCleartext;
  }

  if (attestation.faceIdVerified !== undefined) {
    payload.faceIdVerified = attestation.faceIdVerified;
  }

  if (attestation.appAttestToken) {
    payload.appAttestToken = attestation.appAttestToken;
  }

  const sortedKeys = Object.keys(payload).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    sorted[key] = payload[key];
  }

  return JSON.stringify(sorted);
}

/**
 * Build canonical payload using RFC 8785 JCS.
 * Used for new v2 attestations that opt into JCS canonicalization.
 */
function buildCanonicalPayloadJCS(attestation: Attestation): string {
  const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;
  const payload: Record<string, unknown> = {
    ...(isV2
      ? { cleartextHash: attestation.cleartextHash }
      : { cleartext: attestation.cleartext }),
    deviceId: attestation.deviceId,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash ?? "",
    timestamp: attestation.timestamp,
    version: attestation.version,
  };

  if (isV2 && attestation.encryptedCleartext) {
    payload.encryptedCleartext = attestation.encryptedCleartext;
  }

  if (attestation.faceIdVerified !== undefined) {
    payload.faceIdVerified = attestation.faceIdVerified;
  }

  if (attestation.appAttestToken) {
    payload.appAttestToken = attestation.appAttestToken;
  }

  const result = canonicalize(payload);
  if (!result) throw new Error("JCS canonicalization failed");
  return result;
}

// ── Parse attestation block ──────────────────────────────────────────────────

function parseAttestationBlock(raw: string): Record<string, unknown> {
  const beginMarker = "-----BEGIN KEYWITNESS ATTESTATION-----";
  const endMarker = "-----END KEYWITNESS ATTESTATION-----";

  const beginIdx = raw.indexOf(beginMarker);
  const endIdx = raw.indexOf(endMarker);

  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      "Invalid attestation format: missing BEGIN/END markers. " +
        "Paste the full block including the -----BEGIN KEYWITNESS ATTESTATION----- " +
        "and -----END KEYWITNESS ATTESTATION----- lines.",
    );
  }

  const body = raw
    .slice(beginIdx + beginMarker.length, endIdx)
    .replace(/\s+/g, "");

  if (body.length === 0) {
    throw new Error("Attestation block is empty.");
  }

  let decoded: string;
  try {
    const bytes = base64urlDecode(body);
    decoded = new TextDecoder().decode(bytes);
  } catch {
    throw new Error(
      "Failed to decode attestation body. Ensure the base64url content is intact.",
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error("Attestation body is not valid JSON.");
  }

  return parsed;
}

// ── v3 VC verification ──────────────────────────────────────────────────────

async function verifyV3(
  vc: KeyWitnessVC,
  encryptionKey?: string,
): Promise<VerificationResult> {
  const vcResult: VCVerificationResult = await verifyVC(vc);

  const fingerprint = vcResult.publicKey
    ? await computeFingerprint(base64urlDecode(vcResult.publicKey))
    : undefined;

  let cleartext: string | undefined;
  let keystrokeTimings: KeystrokeTiming[] | undefined;
  let decryptionFailed = false;

  // Decrypt cleartext if encryption key is available
  if (encryptionKey && vc.credentialSubject.encryptedCleartext) {
    try {
      const decryptedJSON = await decryptAESGCM(vc.credentialSubject.encryptedCleartext, encryptionKey);
      const inner = JSON.parse(decryptedJSON);
      const decryptedCleartext: string = inner.cleartext;
      const hash = await sha256Base64url(new TextEncoder().encode(decryptedCleartext));
      if (hash === vc.credentialSubject.cleartextHash) {
        cleartext = decryptedCleartext;
        keystrokeTimings = inner.keystrokeTimings;
      } else {
        decryptionFailed = true;
      }
    } catch {
      decryptionFailed = true;
    }
  }

  // Check for device attestation proof
  const hasDeviceProof = vcResult.proofs.some((p) => p.proofType === "deviceAttestation");
  const hasBiometricProof = vcResult.proofs.some((p) => p.proofType === "biometricVerification" && p.valid);

  return {
    valid: vcResult.valid,
    version: "v3",
    cleartext,
    deviceId: vc.credentialSubject.deviceId,
    faceIdVerified: hasBiometricProof || vc.credentialSubject.faceIdVerified,
    timestamp: vc.validFrom,
    publicKey: vcResult.publicKey,
    publicKeyFingerprint: fingerprint,
    issuerDID: vc.issuer,
    keystrokeBiometricsHash: vc.credentialSubject.keystrokeBiometricsHash,
    keystrokeTimings,
    appAttestPresent: hasDeviceProof,
    appVersion: vc.credentialSubject.appVersion,
    encrypted: !!vc.credentialSubject.encryptedCleartext,
    decryptionFailed: decryptionFailed ? true : undefined,
    cleartextHash: vc.credentialSubject.cleartextHash,
    cleartextLength: vc.credentialSubject.cleartextLength,
    proofs: vcResult.proofs,
    error: vcResult.valid
      ? undefined
      : vcResult.error || "Signature verification failed.",
  };
}

// ── v1/v2 legacy verification ───────────────────────────────────────────────

async function verifyLegacy(
  parsed: Record<string, unknown>,
  encryptionKey?: string,
  manualCleartext?: string,
): Promise<VerificationResult> {
  const attestation = parsed as unknown as Attestation;
  const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;

  // Validate required fields
  const baseRequired: (keyof Attestation)[] = [
    "version", "deviceId", "timestamp", "publicKey", "signature",
  ];
  const required: (keyof Attestation)[] = isV2
    ? [...baseRequired, "cleartextHash"]
    : [...baseRequired, "cleartext"];
  for (const field of required) {
    if (attestation[field] === undefined || attestation[field] === null) {
      throw new Error(`Attestation is missing required field: ${field}`);
    }
  }

  let publicKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try {
    publicKeyBytes = base64urlDecode(attestation.publicKey);
  } catch {
    throw new Error("Invalid public key encoding.");
  }
  try {
    signatureBytes = base64urlDecode(attestation.signature);
  } catch {
    throw new Error("Invalid signature encoding.");
  }

  if (publicKeyBytes.length !== 32) {
    throw new Error(`Invalid public key length: expected 32 bytes, got ${publicKeyBytes.length}.`);
  }
  if (signatureBytes.length !== 64) {
    throw new Error(`Invalid signature length: expected 64 bytes, got ${signatureBytes.length}.`);
  }

  // Try JCS canonical first, fall back to legacy
  let valid = false;
  const jcsCanonical = buildCanonicalPayloadJCS(attestation);
  const jcsBytes = new TextEncoder().encode(jcsCanonical);
  valid = nacl.sign.detached.verify(jcsBytes, signatureBytes, publicKeyBytes);

  if (!valid) {
    // Fall back to legacy canonical (hand-rolled sorted keys)
    const legacyCanonical = buildCanonicalPayloadLegacy(attestation);
    const legacyBytes = new TextEncoder().encode(legacyCanonical);
    valid = nacl.sign.detached.verify(legacyBytes, signatureBytes, publicKeyBytes);
  }

  const fingerprint = await computeFingerprint(publicKeyBytes);
  const issuerDID = ed25519ToDIDKey(publicKeyBytes);

  let cleartext: string | undefined = attestation.cleartext;
  let keystrokeTimings: KeystrokeTiming[] | undefined;
  let decryptionFailed = false;

  if (isV2) {
    if (encryptionKey && attestation.encryptedCleartext) {
      try {
        const decryptedJSON = await decryptAESGCM(attestation.encryptedCleartext, encryptionKey);
        const inner = JSON.parse(decryptedJSON);
        const decryptedCleartext: string = inner.cleartext;
        const hash = await sha256Base64url(new TextEncoder().encode(decryptedCleartext));
        if (hash === attestation.cleartextHash) {
          cleartext = decryptedCleartext;
          keystrokeTimings = inner.keystrokeTimings;
        } else {
          decryptionFailed = true;
        }
      } catch {
        decryptionFailed = true;
      }
    } else if (manualCleartext) {
      const hash = await sha256Base64url(new TextEncoder().encode(manualCleartext));
      if (hash === attestation.cleartextHash) {
        cleartext = manualCleartext;
      } else {
        decryptionFailed = true;
      }
    }
  }

  return {
    valid,
    version: isV2 ? "v2" : "v1",
    cleartext,
    deviceId: attestation.deviceId,
    faceIdVerified: attestation.faceIdVerified,
    timestamp: attestation.timestamp,
    publicKey: attestation.publicKey,
    publicKeyFingerprint: fingerprint,
    issuerDID,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash,
    keystrokeTimings,
    appAttestPresent: !!attestation.appAttestToken,
    encrypted: isV2 ? true : undefined,
    decryptionFailed: decryptionFailed ? true : undefined,
    error: valid
      ? undefined
      : "Signature verification failed. The content may have been tampered with.",
  };
}

// ── Main verification function ───────────────────────────────────────────────

export async function verifyAttestation(
  rawInput: string,
  encryptionKey?: string,
  manualCleartext?: string,
): Promise<VerificationResult> {
  try {
    const parsed = parseAttestationBlock(rawInput.trim());
    const version = detectVersion(parsed);

    if (version === "v3") {
      return await verifyV3(parsed as unknown as KeyWitnessVC, encryptionKey);
    }

    return await verifyLegacy(parsed, encryptionKey, manualCleartext);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: message,
    };
  }
}

export type { ProofVerificationResult };
