import nacl from "tweetnacl";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Attestation {
  version: string;
  cleartext: string;
  deviceId: string;
  faceIdVerified?: boolean;
  timestamp: string;
  publicKey: string; // base64url-encoded Ed25519 public key
  signature: string; // base64url-encoded Ed25519 signature
  keystrokeBiometricsHash?: string;
  keystrokeTimings?: Array<{
    key: string;
    downAt: number;
    upAt: number;
    x?: number;
    y?: number;
    force?: number;
    radius?: number;
  }>;
  appAttestToken?: string;
}

export interface VerificationResult {
  valid: boolean;
  cleartext?: string;
  deviceId?: string;
  faceIdVerified?: boolean;
  timestamp?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  keystrokeBiometricsHash?: string;
  keystrokeTimings?: Array<{
    key: string;
    downAt: number;
    upAt: number;
    x?: number;
    y?: number;
    force?: number;
    radius?: number;
  }>;
  error?: string;
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Fingerprint ──────────────────────────────────────────────────────────────

async function computeFingerprint(publicKeyBytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    publicKeyBytes as unknown as ArrayBuffer,
  );
  const hex = bytesToHex(new Uint8Array(hash));
  return hex
    .slice(0, 32)
    .match(/.{2}/g)!
    .join(":");
}

// ── Canonical payload reconstruction ─────────────────────────────────────────

function buildCanonicalPayload(attestation: Attestation): string {
  const payload: Record<string, unknown> = {
    cleartext: attestation.cleartext,
    deviceId: attestation.deviceId,
    keystrokeBiometricsHash: attestation.keystrokeBiometricsHash ?? "",
    timestamp: attestation.timestamp,
    version: attestation.version,
  };

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

// ── Parse attestation block ──────────────────────────────────────────────────

function parseAttestationBlock(raw: string): Attestation {
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

  let attestation: Attestation;
  try {
    attestation = JSON.parse(decoded);
  } catch {
    throw new Error("Attestation body is not valid JSON.");
  }

  const required: (keyof Attestation)[] = [
    "version",
    "cleartext",
    "deviceId",
    "timestamp",
    "publicKey",
    "signature",
  ];
  for (const field of required) {
    if (attestation[field] === undefined || attestation[field] === null) {
      throw new Error(`Attestation is missing required field: ${field}`);
    }
  }

  return attestation;
}

// ── Main verification function ───────────────────────────────────────────────

export async function verifyAttestation(
  rawInput: string,
): Promise<VerificationResult> {
  try {
    const attestation = parseAttestationBlock(rawInput.trim());

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
      throw new Error(
        `Invalid public key length: expected 32 bytes, got ${publicKeyBytes.length}.`,
      );
    }
    if (signatureBytes.length !== 64) {
      throw new Error(
        `Invalid signature length: expected 64 bytes, got ${signatureBytes.length}.`,
      );
    }

    const canonical = buildCanonicalPayload(attestation);
    const messageBytes = new TextEncoder().encode(canonical);

    const valid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes,
    );

    const fingerprint = await computeFingerprint(publicKeyBytes);

    return {
      valid,
      cleartext: attestation.cleartext,
      deviceId: attestation.deviceId,
      faceIdVerified: attestation.faceIdVerified,
      timestamp: attestation.timestamp,
      publicKey: attestation.publicKey,
      publicKeyFingerprint: fingerprint,
      keystrokeBiometricsHash: attestation.keystrokeBiometricsHash,
      keystrokeTimings: attestation.keystrokeTimings,
      error: valid
        ? undefined
        : "Signature verification failed. The content may have been tampered with.",
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: message,
    };
  }
}
