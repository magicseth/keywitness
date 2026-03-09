/**
 * Server-side attestation verification.
 * Keep in sync with src/lib/verify.ts.
 *
 * Used by the /api/verify HTTP endpoints for third-party integration.
 */

import nacl from "tweetnacl";
import canonicalize from "canonicalize";
import { detectVersion, verifyVC, type KeyWitnessVC, type VCVerificationResult, type ProofVerificationResult } from "./vc";
import { ed25519ToDIDKey } from "./didkey";

// ── Types ────────────────────────────────────────────────────────────────────

interface Attestation {
  version: string;
  cleartext?: string;
  cleartextHash?: string;
  encryptedCleartext?: string;
  deviceId: string;
  faceIdVerified?: boolean;
  timestamp: string;
  publicKey: string;
  signature: string;
  keystrokeBiometricsHash?: string;
  appAttestToken?: string;
}

export interface ServerVerificationResult {
  valid: boolean;
  version?: "v1" | "v2" | "v3";
  deviceId?: string;
  faceIdVerified?: boolean;
  timestamp?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  issuerDID?: string;
  keystrokeBiometricsHash?: string;
  appAttestPresent?: boolean;
  appVersion?: string;
  encrypted?: boolean;
  proofs?: ProofVerificationResult[];
  error?: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function base64urlDecode(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function computeFingerprint(publicKeyBytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(publicKeyBytes));
  const hex = bytesToHex(new Uint8Array(hash));
  return hex.slice(0, 32).match(/.{2}/g)!.join(":");
}

function buildCanonicalPayloadJCS(attestation: Attestation): string {
  const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;
  const payload: Record<string, unknown> = {
    ...(isV2 ? { cleartextHash: attestation.cleartextHash } : { cleartext: attestation.cleartext }),
    deviceId: attestation.deviceId,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash ?? "",
    timestamp: attestation.timestamp,
    version: attestation.version,
  };
  if (isV2 && attestation.encryptedCleartext) payload.encryptedCleartext = attestation.encryptedCleartext;
  if (attestation.faceIdVerified !== undefined) payload.faceIdVerified = attestation.faceIdVerified;
  if (attestation.appAttestToken) payload.appAttestToken = attestation.appAttestToken;
  const result = canonicalize(payload);
  if (!result) throw new Error("JCS canonicalization failed");
  return result;
}

function buildCanonicalPayloadLegacy(attestation: Attestation): string {
  const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;
  const payload: Record<string, unknown> = {
    ...(isV2 ? { cleartextHash: attestation.cleartextHash } : { cleartext: attestation.cleartext }),
    deviceId: attestation.deviceId,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash ?? "",
    timestamp: attestation.timestamp,
    version: attestation.version,
  };
  if (isV2 && attestation.encryptedCleartext) payload.encryptedCleartext = attestation.encryptedCleartext;
  if (attestation.faceIdVerified !== undefined) payload.faceIdVerified = attestation.faceIdVerified;
  if (attestation.appAttestToken) payload.appAttestToken = attestation.appAttestToken;
  const sortedKeys = Object.keys(payload).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of sortedKeys) sorted[key] = payload[key];
  return JSON.stringify(sorted);
}

// ── Parse ────────────────────────────────────────────────────────────────────

function parseAttestationBlock(raw: string): Record<string, unknown> {
  const beginMarker = "-----BEGIN KEYWITNESS ATTESTATION-----";
  const endMarker = "-----END KEYWITNESS ATTESTATION-----";
  const beginIdx = raw.indexOf(beginMarker);
  const endIdx = raw.indexOf(endMarker);
  if (beginIdx === -1 || endIdx === -1) throw new Error("Invalid attestation format: missing BEGIN/END markers.");
  const body = raw.slice(beginIdx + beginMarker.length, endIdx).replace(/\s+/g, "");
  if (body.length === 0) throw new Error("Attestation block is empty.");
  const bytes = base64urlDecode(body);
  const decoded = new TextDecoder().decode(bytes);
  return JSON.parse(decoded);
}

// ── v3 verification ──────────────────────────────────────────────────────────

async function verifyV3(vc: KeyWitnessVC): Promise<ServerVerificationResult> {
  const vcResult: VCVerificationResult = await verifyVC(vc);
  const fingerprint = vcResult.publicKey ? await computeFingerprint(base64urlDecode(vcResult.publicKey)) : undefined;
  const hasDeviceProof = vcResult.proofs.some((p) => p.proofType === "deviceAttestation");
  const hasBiometricProof = vcResult.proofs.some((p) => p.proofType === "biometricVerification" && p.valid);

  return {
    valid: vcResult.valid,
    version: "v3",
    deviceId: vc.credentialSubject.deviceId,
    faceIdVerified: hasBiometricProof || vc.credentialSubject.faceIdVerified,
    timestamp: vc.validFrom,
    publicKey: vcResult.publicKey,
    publicKeyFingerprint: fingerprint,
    issuerDID: vc.issuer,
    keystrokeBiometricsHash: vc.credentialSubject.keystrokeBiometricsHash,
    appAttestPresent: hasDeviceProof,
    appVersion: vc.credentialSubject.appVersion,
    encrypted: !!vc.credentialSubject.encryptedCleartext,
    proofs: vcResult.proofs,
    error: vcResult.valid ? undefined : vcResult.error || "Signature verification failed.",
  };
}

// ── v1/v2 verification ───────────────────────────────────────────────────────

async function verifyLegacy(parsed: Record<string, unknown>): Promise<ServerVerificationResult> {
  const attestation = parsed as unknown as Attestation;
  const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;

  let publicKeyBytes: Uint8Array;
  let signatureBytes: Uint8Array;
  try { publicKeyBytes = base64urlDecode(attestation.publicKey); } catch { throw new Error("Invalid public key encoding."); }
  try { signatureBytes = base64urlDecode(attestation.signature); } catch { throw new Error("Invalid signature encoding."); }
  if (publicKeyBytes.length !== 32) throw new Error(`Invalid public key length: ${publicKeyBytes.length}`);
  if (signatureBytes.length !== 64) throw new Error(`Invalid signature length: ${signatureBytes.length}`);

  let valid = false;
  const jcsBytes = new TextEncoder().encode(buildCanonicalPayloadJCS(attestation));
  valid = nacl.sign.detached.verify(jcsBytes, signatureBytes, publicKeyBytes);
  if (!valid) {
    const legacyBytes = new TextEncoder().encode(buildCanonicalPayloadLegacy(attestation));
    valid = nacl.sign.detached.verify(legacyBytes, signatureBytes, publicKeyBytes);
  }

  const fingerprint = await computeFingerprint(publicKeyBytes);
  const issuerDID = ed25519ToDIDKey(publicKeyBytes);

  return {
    valid,
    version: isV2 ? "v2" : "v1",
    deviceId: attestation.deviceId,
    faceIdVerified: attestation.faceIdVerified,
    timestamp: attestation.timestamp,
    publicKey: attestation.publicKey,
    publicKeyFingerprint: fingerprint,
    issuerDID,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash,
    appAttestPresent: !!attestation.appAttestToken,
    encrypted: isV2 ? true : undefined,
    error: valid ? undefined : "Signature verification failed.",
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

/**
 * Verify an attestation server-side.
 * Does NOT decrypt cleartext (no encryption key provided) — returns
 * only verification metadata safe for public APIs.
 */
export async function verifyAttestationServerSide(rawInput: string): Promise<ServerVerificationResult> {
  try {
    const parsed = parseAttestationBlock(rawInput.trim());
    const version = detectVersion(parsed);
    if (version === "v3") return await verifyV3(parsed as unknown as KeyWitnessVC);
    return await verifyLegacy(parsed);
  } catch (err: unknown) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  }
}
