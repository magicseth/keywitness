/**
 * KeyWitness Attestation Protocol — shared TypeScript implementation.
 *
 * Isomorphic: works in browsers (Web Crypto) and Node.js (crypto module).
 * Uses Ed25519 via tweetnacl for signing and verification.
 *
 * @module
 */

import nacl from "tweetnacl";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURRENT_VERSION = 1;
const BEGIN_MARKER = "-----BEGIN KEYWITNESS ATTESTATION-----";
const END_MARKER = "-----END KEYWITNESS ATTESTATION-----";

/**
 * Ordered list of fields that form the canonical signing payload.
 * `appAttestToken` is only included when present.
 */
const SIGNING_FIELD_ORDER = [
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

/** The core attestation data that gets signed. */
export interface AttestationPayload {
  /** Protocol version. Currently 1. */
  version: number;
  /** The text that was typed. */
  cleartext: string;
  /** Opaque device identifier. */
  deviceId: string;
  /** ISO-8601 timestamp of when the text was finalized. */
  timestamp: string;
  /** Hex-encoded SHA-256 hash of the raw keystroke biometric data. */
  keystrokeBiometricsHash: string;
  /** Apple App Attest / Android key attestation token (base64url). */
  appAttestToken?: string;
}

/** A complete, signed attestation. */
export interface Attestation extends AttestationPayload {
  /** Base64url-encoded Ed25519 signature over the canonical payload. */
  signature: string;
  /** Base64url-encoded Ed25519 public key of the signing device. */
  publicKey: string;
}

/** The result of verifying an attestation. */
export interface VerificationResult {
  valid: boolean;
  /** Human-readable reason when `valid` is false. */
  reason?: string;
  /** The parsed attestation, present regardless of validity. */
  attestation?: Attestation;
}

// ---------------------------------------------------------------------------
// Base64url helpers  (RFC 4648 section 5, no padding)
// ---------------------------------------------------------------------------

function base64urlEncode(bytes: Uint8Array): string {
  // In browsers, btoa is available globally; in Node 16+ Buffer works.
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
  // Restore standard base64
  let b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding
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
// SHA-256 hashing (Web Crypto with Node.js fallback)
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 hash of arbitrary binary data.
 * Returns the hash as a lowercase hex string.
 *
 * Uses the Web Crypto API when available, otherwise falls back to Node.js
 * `crypto` module.
 */
export async function sha256hex(data: Uint8Array): Promise<string> {
  let hashBuffer: ArrayBuffer;

  // Prefer Web Crypto (available in browsers and Node 15+)
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined"
  ) {
    hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data as ArrayBufferView<ArrayBuffer>);
  } else {
    // Node.js fallback
    // Dynamic import keeps this from breaking bundlers that target browsers.
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

/**
 * Hash raw keystroke biometric data (JSON-serialized timing array, or any
 * Uint8Array) and return the hex-encoded SHA-256 digest.
 *
 * Convenience wrapper: accepts either a `Uint8Array` or a `string` (which
 * will be UTF-8 encoded before hashing).
 */
export async function hashKeystrokeBiometrics(
  data: Uint8Array | string,
): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  return sha256hex(bytes);
}

// ---------------------------------------------------------------------------
// Canonical signing payload
// ---------------------------------------------------------------------------

/**
 * Build the canonical JSON string that is signed / verified.
 *
 * Field order is fixed (see protocol.md section 3). `appAttestToken` is
 * omitted when it is `undefined` or `null`.
 *
 * This function performs **deterministic** serialization by manually
 * constructing the JSON string — it never relies on engine key ordering.
 */
export function buildSigningPayload(fields: AttestationPayload): string {
  const parts: string[] = [];

  for (const key of SIGNING_FIELD_ORDER) {
    const value = fields[key];
    if (value === undefined || value === null) {
      // Only appAttestToken is optional; skip it when absent.
      continue;
    }
    parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
  }

  return `{${parts.join(",")}}`;
}

/**
 * Encode the signing payload as UTF-8 bytes, ready for Ed25519 sign/verify.
 */
export function buildSigningPayloadBytes(
  fields: AttestationPayload,
): Uint8Array {
  return new TextEncoder().encode(buildSigningPayload(fields));
}

// ---------------------------------------------------------------------------
// Signing (for device-side use)
// ---------------------------------------------------------------------------

/**
 * Sign an attestation payload with the given Ed25519 secret key.
 *
 * @param payload  The attestation fields to sign (everything except signature
 *                 and publicKey).
 * @param secretKey  The 64-byte Ed25519 secret key (as returned by
 *                   `nacl.sign.keyPair()`).
 * @returns A complete {@link Attestation} with `signature` and `publicKey`
 *          populated.
 */
export function signAttestation(
  payload: AttestationPayload,
  secretKey: Uint8Array,
): Attestation {
  if (secretKey.length !== nacl.sign.secretKeyLength) {
    throw new Error(
      `secretKey must be ${nacl.sign.secretKeyLength} bytes, got ${secretKey.length}`,
    );
  }

  const message = buildSigningPayloadBytes(payload);
  const signature = nacl.sign.detached(message, secretKey);
  const publicKey = secretKey.slice(32); // last 32 bytes of nacl secret key

  return {
    ...payload,
    signature: base64urlEncode(signature),
    publicKey: base64urlEncode(publicKey),
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Verify a parsed {@link Attestation} object.
 *
 * Checks:
 * 1. Version is supported.
 * 2. Required fields are present and correctly typed.
 * 3. Ed25519 signature is valid over the canonical payload.
 */
export function verifyAttestation(attestation: Attestation): VerificationResult {
  // --- version check ---
  if (attestation.version !== CURRENT_VERSION) {
    return {
      valid: false,
      reason: `Unsupported version: ${attestation.version} (expected ${CURRENT_VERSION})`,
      attestation,
    };
  }

  // --- required field checks ---
  const requiredStrings: Array<keyof Attestation> = [
    "cleartext",
    "deviceId",
    "timestamp",
    "keystrokeBiometricsHash",
    "signature",
    "publicKey",
  ];
  for (const field of requiredStrings) {
    if (typeof attestation[field] !== "string" || attestation[field] === "") {
      return {
        valid: false,
        reason: `Missing or invalid required field: ${field}`,
        attestation,
      };
    }
  }

  // --- decode key & signature ---
  let signatureBytes: Uint8Array;
  let publicKeyBytes: Uint8Array;
  try {
    signatureBytes = base64urlDecode(attestation.signature);
  } catch {
    return { valid: false, reason: "Malformed base64url in signature", attestation };
  }
  try {
    publicKeyBytes = base64urlDecode(attestation.publicKey);
  } catch {
    return { valid: false, reason: "Malformed base64url in publicKey", attestation };
  }

  if (signatureBytes.length !== nacl.sign.signatureLength) {
    return {
      valid: false,
      reason: `Signature must be ${nacl.sign.signatureLength} bytes, got ${signatureBytes.length}`,
      attestation,
    };
  }
  if (publicKeyBytes.length !== nacl.sign.publicKeyLength) {
    return {
      valid: false,
      reason: `Public key must be ${nacl.sign.publicKeyLength} bytes, got ${publicKeyBytes.length}`,
      attestation,
    };
  }

  // --- reconstruct payload & verify ---
  const payload: AttestationPayload = {
    version: attestation.version,
    cleartext: attestation.cleartext,
    deviceId: attestation.deviceId,
    timestamp: attestation.timestamp,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash,
    ...(attestation.appAttestToken !== undefined &&
    attestation.appAttestToken !== null
      ? { appAttestToken: attestation.appAttestToken }
      : {}),
  };

  const message = buildSigningPayloadBytes(payload);
  const valid = nacl.sign.detached.verify(message, signatureBytes, publicKeyBytes);

  if (!valid) {
    return { valid: false, reason: "Ed25519 signature verification failed", attestation };
  }

  return { valid: true, attestation };
}

/**
 * Parse a raw JSON string into an {@link Attestation} and verify it.
 */
export function verifyAttestationJSON(json: string): VerificationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { valid: false, reason: "Invalid JSON" };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { valid: false, reason: "Attestation must be a JSON object" };
  }

  return verifyAttestation(parsed as Attestation);
}

// ---------------------------------------------------------------------------
// Armored text encoding / decoding
// ---------------------------------------------------------------------------

/**
 * Encode an {@link Attestation} into an armored text block:
 *
 * ```
 * -----BEGIN KEYWITNESS ATTESTATION-----
 * <base64url-encoded JSON>
 * -----END KEYWITNESS ATTESTATION-----
 * ```
 */
export function encodeAttestationBlock(attestation: Attestation): string {
  const json = JSON.stringify(attestation);
  const encoded = base64urlEncodeString(json);
  return `${BEGIN_MARKER}\n${encoded}\n${END_MARKER}`;
}

/**
 * Decode an armored text block back into an {@link Attestation}.
 *
 * @throws {Error} if the block is malformed.
 */
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

/**
 * Extract all attestation blocks from a document / string that may contain
 * other text around them.
 *
 * Returns an array of raw block strings (including markers).
 */
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

/**
 * Generate a new Ed25519 key pair for device signing.
 *
 * @returns An object with `publicKey` and `secretKey` as raw `Uint8Array`s.
 */
export function generateKeyPair(): nacl.SignKeyPair {
  return nacl.sign.keyPair();
}
