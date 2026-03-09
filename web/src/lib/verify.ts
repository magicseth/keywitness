import nacl from "tweetnacl";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Attestation {
  version: string;
  cleartext?: string;           // v1 only
  cleartextHash?: string;       // v2: base64url SHA-256 of cleartext
  encryptedCleartext?: string;  // v2: base64url AES-GCM ciphertext (nonce||ct||tag) — contains cleartext + keystrokeTimings
  deviceId: string;
  faceIdVerified?: boolean;
  timestamp: string;
  publicKey: string; // base64url-encoded Ed25519 public key
  signature: string; // base64url-encoded Ed25519 signature
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

export interface VerificationResult {
  valid: boolean;
  cleartext?: string;
  deviceId?: string;
  faceIdVerified?: boolean;
  timestamp?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  keystrokeBiometricsHash?: string;
  keystrokeTimings?: KeystrokeTiming[];
  appAttestPresent?: boolean;  // true if attestation includes App Attest token
  error?: string;
  encrypted?: boolean;       // true for v2
  decryptionFailed?: boolean; // true if key missing/wrong
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

// ── Canonical payload reconstruction ─────────────────────────────────────────

function buildCanonicalPayload(attestation: Attestation): string {
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

  // v2: encryptedCleartext is signed so the ciphertext cannot be swapped
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

  const baseRequired: (keyof Attestation)[] = [
    "version",
    "deviceId",
    "timestamp",
    "publicKey",
    "signature",
  ];
  const isV2 = attestation.cleartextHash !== undefined;
  const required: (keyof Attestation)[] = isV2
    ? [...baseRequired, "cleartextHash"]
    : [...baseRequired, "cleartext"];
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
  encryptionKey?: string,
  manualCleartext?: string,
): Promise<VerificationResult> {
  try {
    const attestation = parseAttestationBlock(rawInput.trim());
    const isV2 = attestation.cleartextHash !== undefined && attestation.cleartext === undefined;

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

    let cleartext: string | undefined = attestation.cleartext;
    let keystrokeTimings: KeystrokeTiming[] | undefined;
    let decryptionFailed = false;

    if (isV2) {
      if (encryptionKey && attestation.encryptedCleartext) {
        try {
          const decryptedJSON = await decryptAESGCM(attestation.encryptedCleartext, encryptionKey);
          // Inner payload contains { cleartext, keystrokeTimings }
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
          // keystrokeTimings unavailable without encryption key
        } else {
          decryptionFailed = true;
        }
      }
    }

    return {
      valid,
      cleartext,
      deviceId: attestation.deviceId,
      faceIdVerified: attestation.faceIdVerified,
      timestamp: attestation.timestamp,
      publicKey: attestation.publicKey,
      publicKeyFingerprint: fingerprint,
      keystrokeBiometricsHash: attestation.keystrokeBiometricsHash,
      keystrokeTimings,
      appAttestPresent: !!attestation.appAttestToken,
      encrypted: isV2 ? true : undefined,
      decryptionFailed: decryptionFailed ? true : undefined,
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
