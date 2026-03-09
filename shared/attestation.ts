/**
 * KeyWitness Attestation Protocol — shared TypeScript implementation.
 *
 * Supports v1 (cleartext), v2 (encrypted), and v3 (W3C VC 2.0) formats.
 * Isomorphic: works in browsers (Web Crypto) and Node.js (crypto module).
 * Uses Ed25519 via tweetnacl for signing and verification.
 *
 * @module
 */

import nacl from "tweetnacl";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const V1_VERSION = 1;
const V2_VERSION = "keywitness-v2";
const BEGIN_MARKER = "-----BEGIN KEYWITNESS ATTESTATION-----";
const END_MARKER = "-----END KEYWITNESS ATTESTATION-----";

/**
 * v1 field order (fixed, not alphabetical).
 */
const V1_SIGNING_FIELD_ORDER = [
  "version",
  "cleartext",
  "deviceId",
  "timestamp",
  "keystrokeBiometricsHash",
  "appAttestToken",
] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** v1 attestation payload. */
export interface AttestationPayloadV1 {
  version: number;
  cleartext: string;
  deviceId: string;
  timestamp: string;
  keystrokeBiometricsHash: string;
  appAttestToken?: string;
}

/** v2 attestation payload. */
export interface AttestationPayloadV2 {
  version: string;
  cleartextHash: string;
  encryptedCleartext: string;
  deviceId: string;
  faceIdVerified: boolean;
  timestamp: string;
  keystrokeBiometricsHash: string;
  appAttestToken?: string;
}

/** A complete, signed v1 attestation. */
export interface AttestationV1 extends AttestationPayloadV1 {
  signature: string;
  publicKey: string;
}

/** A complete, signed v2 attestation. */
export interface AttestationV2 extends AttestationPayloadV2 {
  signature: string;
  publicKey: string;
}

/** W3C VC 2.0 credential subject. */
export interface VCCredentialSubject {
  type: "HumanTypedContent";
  cleartextHash: string;
  encryptedCleartext?: string;
  deviceId: string;
  keystrokeBiometricsHash: string;
  faceIdVerified?: boolean;
}

/** Data Integrity proof (eddsa-jcs-2022). */
export interface DataIntegrityProof {
  type: "DataIntegrityProof";
  cryptosuite: "eddsa-jcs-2022";
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
  proofType?: string;
}

/** Apple App Attest proof. */
export interface AppAttestProof {
  type: "AppleAppAttestProof";
  created: string;
  keyId: string;
  assertionData?: string;
  clientData?: string;
  proofType: "deviceAttestation";
  serverVerified?: boolean;
}

/** v3 VC attestation. */
export interface AttestationV3 {
  "@context": string[];
  type: string[];
  issuer: string;
  validFrom: string;
  credentialSubject: VCCredentialSubject;
  proof: (DataIntegrityProof | AppAttestProof) | (DataIntegrityProof | AppAttestProof)[];
  publicKey?: string;
}

/** Union of all attestation types. */
export type Attestation = AttestationV1 | AttestationV2 | AttestationV3;

/** The result of verifying an attestation. */
export interface VerificationResult {
  valid: boolean;
  version: "v1" | "v2" | "v3";
  reason?: string;
  attestation?: Attestation;
}

// ---------------------------------------------------------------------------
// Version detection
// ---------------------------------------------------------------------------

export function detectVersion(parsed: Record<string, unknown>): "v1" | "v2" | "v3" {
  if (parsed["@context"]) return "v3";
  if (parsed.cleartextHash) return "v2";
  return "v1";
}

// ---------------------------------------------------------------------------
// Base64url helpers  (RFC 4648 section 5, no padding)
// ---------------------------------------------------------------------------

function base64urlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 =
    typeof btoa === "function"
      ? btoa(binary)
      : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) {
    b64 += "=";
  }
  if (typeof atob === "function") {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function base64urlEncodeString(input: string): string {
  return base64urlEncode(new TextEncoder().encode(input));
}

function base64urlDecodeString(encoded: string): string {
  return new TextDecoder().decode(base64urlDecode(encoded));
}

// ---------------------------------------------------------------------------
// did:key helpers
// ---------------------------------------------------------------------------

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

/** Encode an Ed25519 public key as a did:key identifier. */
export function ed25519ToDIDKey(publicKeyBytes: Uint8Array): string {
  if (publicKeyBytes.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKeyBytes.length}`);
  }
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKeyBytes.length);
  prefixed.set(ED25519_MULTICODEC, 0);
  prefixed.set(publicKeyBytes, ED25519_MULTICODEC.length);
  return `did:key:z${base58btcEncode(prefixed)}`;
}

/** Decode a did:key to extract raw Ed25519 public key bytes. */
export function decodeDIDKey(did: string): Uint8Array {
  if (!did.startsWith("did:key:z")) {
    throw new Error(`Invalid did:key format: ${did}`);
  }
  const decoded = base58btcDecode(did.slice("did:key:z".length));
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("Not an Ed25519 did:key");
  }
  return decoded.slice(2);
}

/** Build verification method ID from did:key. */
export function verificationMethodId(did: string): string {
  const fragment = did.slice("did:key:".length);
  return `${did}#${fragment}`;
}

// ---------------------------------------------------------------------------
// Base58btc (Bitcoin alphabet)
// ---------------------------------------------------------------------------

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58btcEncode(data: Uint8Array): string {
  const bytes = Array.from(data);
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }

  const result: string[] = [];
  let num = bytes.reduce((acc, b) => acc * 256n + BigInt(b), 0n);
  while (num > 0n) {
    result.unshift(BASE58_ALPHABET[Number(num % 58n)]);
    num = num / 58n;
  }

  for (let i = 0; i < leadingZeros; i++) {
    result.unshift(BASE58_ALPHABET[0]);
  }

  return result.join("");
}

function base58btcDecode(str: string): Uint8Array {
  let leadingOnes = 0;
  for (const c of str) {
    if (c === BASE58_ALPHABET[0]) leadingOnes++;
    else break;
  }

  let num = 0n;
  for (const c of str) {
    const idx = BASE58_ALPHABET.indexOf(c);
    if (idx === -1) throw new Error(`Invalid base58 character: ${c}`);
    num = num * 58n + BigInt(idx);
  }

  const hex = num === 0n ? "" : num.toString(16);
  const paddedHex = hex.length % 2 ? "0" + hex : hex;
  const dataBytes: number[] = [];
  for (let i = 0; i < paddedHex.length; i += 2) {
    dataBytes.push(parseInt(paddedHex.slice(i, i + 2), 16));
  }

  const zeros = new Array(leadingOnes).fill(0);
  return new Uint8Array([...zeros, ...dataBytes]);
}

/** Encode bytes as multibase z (base58btc). */
export function multibaseEncode(bytes: Uint8Array): string {
  return `z${base58btcEncode(bytes)}`;
}

/** Decode multibase z string to raw bytes. */
export function multibaseDecode(encoded: string): Uint8Array {
  if (!encoded.startsWith("z")) {
    throw new Error(`Unsupported multibase prefix: ${encoded[0]}`);
  }
  return base58btcDecode(encoded.slice(1));
}

// ---------------------------------------------------------------------------
// SHA-256 hashing (Web Crypto with Node.js fallback)
// ---------------------------------------------------------------------------

export async function sha256hex(data: Uint8Array): Promise<string> {
  let hashBuffer: ArrayBuffer;

  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined"
  ) {
    hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data as ArrayBufferView<ArrayBuffer>);
  } else {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(data).digest();
    hashBuffer = hash.buffer.slice(
      hash.byteOffset,
      hash.byteOffset + hash.byteLength,
    );
  }

  const bytes = new Uint8Array(hashBuffer);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashKeystrokeBiometrics(
  data: Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return sha256hex(bytes);
}

// ---------------------------------------------------------------------------
// v1 canonical signing payload
// ---------------------------------------------------------------------------

export function buildSigningPayload(fields: AttestationPayloadV1): string {
  const parts: string[] = [];

  for (const key of V1_SIGNING_FIELD_ORDER) {
    const value = fields[key];
    if (value === undefined || value === null) {
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }

  return `{${parts.join(",")}}`;
}

export function buildSigningPayloadBytes(
  fields: AttestationPayloadV1,
): Uint8Array {
  return new TextEncoder().encode(buildSigningPayload(fields));
}

// ---------------------------------------------------------------------------
// Signing (for device-side use)
// ---------------------------------------------------------------------------

export function signAttestation(
  payload: AttestationPayloadV1,
  secretKey: Uint8Array,
): AttestationV1 {
  if (secretKey.length !== nacl.sign.secretKeyLength) {
    throw new Error(
      `secretKey must be ${nacl.sign.secretKeyLength} bytes, got ${secretKey.length}`,
    );
  }

  const message = buildSigningPayloadBytes(payload);
  const signature = nacl.sign.detached(message, secretKey);
  const publicKey = secretKey.slice(32);

  return {
    ...payload,
    signature: base64urlEncode(signature),
    publicKey: base64urlEncode(publicKey),
  };
}

// ---------------------------------------------------------------------------
// v1 verification
// ---------------------------------------------------------------------------

export function verifyAttestationV1(attestation: AttestationV1): VerificationResult {
  if (attestation.version !== V1_VERSION) {
    return {
      valid: false,
      version: "v1",
      reason: `Unsupported version: ${attestation.version} (expected ${V1_VERSION})`,
      attestation,
    };
  }

  const requiredStrings: Array<keyof AttestationV1> = [
    "cleartext", "deviceId", "timestamp", "keystrokeBiometricsHash", "signature", "publicKey",
  ];
  for (const field of requiredStrings) {
    if (typeof attestation[field] !== "string" || attestation[field] === "") {
      return { valid: false, version: "v1", reason: `Missing or invalid required field: ${field}`, attestation };
    }
  }

  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecode(attestation.signature);
  } catch {
    return { valid: false, version: "v1", reason: "Malformed base64url in signature", attestation };
  }
  try {
    publicKeyBytes = base64urlDecode(attestation.publicKey);
  } catch {
    return { valid: false, version: "v1", reason: "Malformed base64url in publicKey", attestation };
  }

  if (signatureBytes.length !== nacl.sign.signatureLength) {
    return { valid: false, version: "v1", reason: `Signature must be ${nacl.sign.signatureLength} bytes`, attestation };
  }
  if (publicKeyBytes.length !== nacl.sign.publicKeyLength) {
    return { valid: false, version: "v1", reason: `Public key must be ${nacl.sign.publicKeyLength} bytes`, attestation };
  }

  const payload: AttestationPayloadV1 = {
    version: attestation.version,
    cleartext: attestation.cleartext,
    deviceId: attestation.deviceId,
    timestamp: attestation.timestamp,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash,
    ...(attestation.appAttestToken != null ? { appAttestToken: attestation.appAttestToken } : {}),
  };

  const message = buildSigningPayloadBytes(payload);
  const valid = nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);

  if (!valid) {
    return { valid: false, version: "v1", reason: "Ed25519 signature verification failed", attestation };
  }

  return { valid: true, version: "v1", attestation };
}

// ---------------------------------------------------------------------------
// Generic verification (detects version)
// ---------------------------------------------------------------------------

export function verifyAttestationJSON(json: string): VerificationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { valid: false, version: "v1", reason: "Invalid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, version: "v1", reason: "Attestation must be a JSON object" };
  }

  const version = detectVersion(parsed as Record<string, unknown>);
  if (version === "v1") {
    return verifyAttestationV1(parsed as AttestationV1);
  }

  // v2 and v3 verification requires async (AES decryption, Web Crypto)
  // Use the web verify.ts for full v2/v3 verification
  return { valid: false, version, reason: `Use web verifier for ${version} attestations` };
}

// ---------------------------------------------------------------------------
// Armored text encoding / decoding
// ---------------------------------------------------------------------------

export function encodeAttestationBlock(attestation: Attestation): string {
  const json = JSON.stringify(attestation);
  const encoded = base64urlEncodeString(json);
  return `${BEGIN_MARKER}\n${encoded}\n${END_MARKER}`;
}

export function decodeAttestationBlock(block: string): Attestation {
  const trimmed = block.trim();
  if (!trimmed.startsWith(BEGIN_MARKER)) {
    throw new Error("Missing BEGIN KEYWITNESS ATTESTATION marker");
  }
  if (!trimmed.endsWith(END_MARKER)) {
    throw new Error("Missing END KEYWITNESS ATTESTATION marker");
  }

  const inner = trimmed
    .slice(BEGIN_MARKER.length, trimmed.length - END_MARKER.length)
    .trim();

  if (inner.length === 0) {
    throw new Error("Empty attestation block");
  }

  const json = base64urlDecodeString(inner);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Attestation block contains invalid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Attestation block does not contain a JSON object");
  }

  return parsed as Attestation;
}

export function extractAttestationBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const start = text.indexOf(BEGIN_MARKER, cursor);
    if (start === -1) break;
    const end = text.indexOf(END_MARKER, start);
    if (end === -1) break;
    blocks.push(text.slice(start, end + END_MARKER.length));
    cursor = end + END_MARKER.length;
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Key generation helper
// ---------------------------------------------------------------------------

export function generateKeyPair(): nacl.SignKeyPair {
  return nacl.sign.keyPair();
}
