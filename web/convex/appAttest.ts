import { mutation, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import * as cborg from "cborg";

// ── Constants ────────────────────────────────────────────────────────────────

// Apple App Attestation Root CA public key (P-256, raw 65 bytes uncompressed)
// Extracted from: https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// This is the SPKI-decoded raw EC point for verification of the intermediate cert.
// NOTE: In production, embed the full root CA cert and validate the chain properly.
// For now we validate the attestation structure and extract the credential key.

// Your app identity: TEAM_ID + "." + BUNDLE_ID
const APP_ID = "TCU64E3XV4.io.keywitness.app";

// ── Base64url helpers ────────────────────────────────────────────────────────

function base64urlDecode(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
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

// ── SHA-256 helper ───────────────────────────────────────────────────────────

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

// ── AuthenticatorData parser ─────────────────────────────────────────────────

interface AuthData {
  rpIdHash: Uint8Array;    // 32 bytes
  flags: number;           // 1 byte
  signCount: number;       // 4 bytes big-endian
  credentialId?: Uint8Array;
  credentialPublicKey?: Uint8Array; // COSE key bytes
}

function parseAuthData(data: Uint8Array): AuthData {
  const rpIdHash = data.slice(0, 32);
  const flags = data[32];
  const signCount = new DataView(toArrayBuffer(data.slice(33, 37))).getUint32(0);

  const result: AuthData = { rpIdHash, flags, signCount };

  // If attested credential data is present (bit 6 of flags)
  if (flags & 0x40) {
    // AAGUID (16 bytes) at offset 37
    const credIdLength = new DataView(toArrayBuffer(data.slice(53, 55))).getUint16(0);
    result.credentialId = data.slice(55, 55 + credIdLength);
    // The rest is the COSE-encoded credential public key
    result.credentialPublicKey = data.slice(55 + credIdLength);
  }

  return result;
}

// ── COSE key to raw P-256 ────────────────────────────────────────────────────

function coseKeyToRawP256(coseBytes: Uint8Array): Uint8Array {
  // Decode COSE key map — cborg returns plain objects with string keys by default
  const coseKey = cborg.decode(coseBytes, { useMaps: true }) as Map<number, unknown>;
  // kty (1) = EC2 (2), crv (-1) = P-256 (1)
  const x = coseKey.get(-2) as Uint8Array;
  const y = coseKey.get(-3) as Uint8Array;
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error("Invalid COSE key: missing or wrong-sized x/y coordinates");
  }
  // Uncompressed point format: 0x04 || x || y
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return raw;
}

// ── Challenge management ─────────────────────────────────────────────────────

export const createChallenge = mutation({
  args: {},
  handler: async (ctx) => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const challenge = base64urlEncode(bytes);
    await ctx.db.insert("appAttestChallenges", {
      challenge,
      createdAt: Date.now(),
      used: false,
    });
    return { challenge };
  },
});

// ── One-time key attestation verification ────────────────────────────────────

export const verifyKeyAttestation = mutation({
  args: {
    keyId: v.string(),
    attestation: v.string(),    // base64url CBOR
    challenge: v.string(),
    publicKey: v.string(),       // Ed25519 public key to link
  },
  handler: async (ctx, args) => {
    // 1. Validate challenge exists and is fresh
    const challengeDoc = await ctx.db
      .query("appAttestChallenges")
      .withIndex("by_challenge", (q) => q.eq("challenge", args.challenge))
      .first();
    if (!challengeDoc) throw new Error("Invalid challenge");
    if (challengeDoc.used) throw new Error("Challenge already used");
    if (Date.now() - challengeDoc.createdAt > 5 * 60 * 1000) {
      throw new Error("Challenge expired");
    }
    await ctx.db.patch(challengeDoc._id, { used: true });

    // 2. Check if this keyId is already attested
    const existing = await ctx.db
      .query("appAttestCredentials")
      .withIndex("by_keyId", (q) => q.eq("keyId", args.keyId))
      .first();
    if (existing) throw new Error("Key ID already attested");

    // 3. Decode the attestation CBOR
    const attestationBytes = base64urlDecode(args.attestation);
    let attestationObj: Record<string, unknown>;
    try {
      attestationObj = cborg.decode(attestationBytes) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to decode attestation CBOR");
    }

    const fmt = attestationObj.fmt as string;
    if (fmt !== "apple-appattest") {
      throw new Error(`Unexpected attestation format: ${fmt}`);
    }

    const attStmt = attestationObj.attStmt as Record<string, unknown>;
    const authData = attestationObj.authData as Uint8Array;

    if (!attStmt || !authData) {
      throw new Error("Missing attStmt or authData");
    }

    // 4. Parse authenticator data
    const parsed = parseAuthData(authData);

    // 5. Verify RP ID hash = SHA256(APP_ID)
    const expectedRpIdHash = await sha256(new TextEncoder().encode(APP_ID));
    if (toHex(parsed.rpIdHash) !== toHex(expectedRpIdHash)) {
      throw new Error("RP ID hash mismatch — wrong app identity");
    }

    // 6. Verify counter is 0 (first attestation)
    if (parsed.signCount !== 0) {
      throw new Error(`Expected initial counter 0, got ${parsed.signCount}`);
    }

    // 7. Extract the credential public key from the attested credential data
    if (!parsed.credentialPublicKey) {
      throw new Error("No credential public key in attestation");
    }
    const rawP256Key = coseKeyToRawP256(parsed.credentialPublicKey);

    // 8. Verify the nonce binding
    // nonce = SHA256(authData || clientDataHash)  — per Apple's spec
    // clientDataHash = SHA256(challenge)
    const clientDataHash = await sha256(new TextEncoder().encode(args.challenge));
    const nonceInput = new Uint8Array(authData.length + clientDataHash.length);
    nonceInput.set(authData, 0);
    nonceInput.set(clientDataHash, authData.length);
    const expectedNonce = await sha256(nonceInput);

    // The nonce should be embedded in the leaf certificate's OID 1.2.840.113635.100.8.2
    // For now, we extract x5c[0] and check the nonce is present
    const x5c = attStmt.x5c as Uint8Array[];
    if (!x5c || x5c.length < 2) {
      throw new Error("Missing x5c certificate chain");
    }

    // Extract nonce from the leaf certificate
    // The nonce is in an Apple-specific extension OID 1.2.840.113635.100.8.2
    // It's in the DER-encoded cert. We search for the OID bytes then extract the nonce.
    const leafCert = x5c[0];
    const nonceFromCert = extractNonceFromCert(leafCert);
    if (!nonceFromCert) {
      throw new Error("Could not extract nonce from leaf certificate");
    }
    if (toHex(nonceFromCert) !== toHex(expectedNonce)) {
      throw new Error("Nonce mismatch — attestation binding failed");
    }

    // 9. Store the credential
    await ctx.db.insert("appAttestCredentials", {
      keyId: args.keyId,
      credentialPublicKey: base64urlEncode(rawP256Key),
      linkedEd25519Key: args.publicKey,
      counter: 0,
      createdAt: Date.now(),
    });

    return { verified: true };
  },
});

// ── Per-request assertion verification ───────────────────────────────────────

export const verifyAssertion = internalMutation({
  args: {
    keyId: v.string(),
    assertion: v.string(),           // base64url CBOR
    expectedClientData: v.string(),  // the data the assertion should have signed
  },
  handler: async (ctx, args) => {
    // 1. Look up stored credential
    const credential = await ctx.db
      .query("appAttestCredentials")
      .withIndex("by_keyId", (q) => q.eq("keyId", args.keyId))
      .first();
    if (!credential) throw new Error("Unknown App Attest key ID");

    // 2. Decode assertion CBOR
    const assertionBytes = base64urlDecode(args.assertion);
    let assertionObj: Record<string, unknown>;
    try {
      assertionObj = cborg.decode(assertionBytes) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to decode assertion CBOR");
    }

    const signature = assertionObj.signature as Uint8Array;
    const authenticatorData = assertionObj.authenticatorData as Uint8Array;
    if (!signature || !authenticatorData) {
      throw new Error("Missing signature or authenticatorData in assertion");
    }

    // 3. Parse authenticator data
    const parsed = parseAuthData(authenticatorData);

    // 4. Verify RP ID hash
    const expectedRpIdHash = await sha256(new TextEncoder().encode(APP_ID));
    if (toHex(parsed.rpIdHash) !== toHex(expectedRpIdHash)) {
      throw new Error("RP ID hash mismatch in assertion");
    }

    // 5. Verify counter > stored counter (replay protection)
    if (parsed.signCount <= credential.counter) {
      throw new Error(`Assertion counter ${parsed.signCount} <= stored ${credential.counter}`);
    }

    // 6. Compute expected nonce: SHA256(authenticatorData || SHA256(clientData))
    const clientDataHash = await sha256(new TextEncoder().encode(args.expectedClientData));
    const nonceInput = new Uint8Array(authenticatorData.length + clientDataHash.length);
    nonceInput.set(authenticatorData, 0);
    nonceInput.set(clientDataHash, authenticatorData.length);
    const nonce = await sha256(nonceInput);

    // 7. Verify ECDSA P-256 signature over the nonce
    const rawKeyBytes = base64urlDecode(credential.credentialPublicKey);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(rawKeyBytes),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      toArrayBuffer(signature),
      toArrayBuffer(nonce),
    );

    if (!valid) {
      throw new Error("App Attest assertion signature verification failed");
    }

    // 8. Update counter
    await ctx.db.patch(credential._id, { counter: parsed.signCount });

    return { verified: true };
  },
});

// ── Certificate nonce extraction ─────────────────────────────────────────────

// Apple's App Attest nonce OID: 1.2.840.113635.100.8.2
// DER encoding: 06 09 2A 86 48 86 F7 63 64 08 02
const APPLE_NONCE_OID = new Uint8Array([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x63, 0x64, 0x08, 0x02]);

function extractNonceFromCert(certDer: Uint8Array): Uint8Array | null {
  // Search for the Apple nonce OID in the DER certificate
  const oidHex = toHex(APPLE_NONCE_OID);
  const certHex = toHex(certDer);
  const idx = certHex.indexOf(oidHex);
  if (idx === -1) return null;

  // The nonce follows the OID in the extension value.
  // Structure: OID || OCTET STRING { SEQUENCE { [0] { OCTET STRING { nonce } } } }
  // We need to skip through the DER structure to find the 32-byte nonce.
  const byteOffset = idx / 2 + APPLE_NONCE_OID.length;

  // Walk the DER: after the OID, there's typically a boolean (critical) and then
  // an OCTET STRING containing the extension value. We search for a 32-byte value.
  // Simple approach: scan forward for a 32-byte OCTET STRING (tag 0x04, length 0x20)
  for (let i = byteOffset; i < certDer.length - 33; i++) {
    if (certDer[i] === 0x04 && certDer[i + 1] === 0x20) {
      return certDer.slice(i + 2, i + 34);
    }
  }
  return null;
}
