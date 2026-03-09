import { mutation, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import * as cborg from "cborg";

// ── Constants ────────────────────────────────────────────────────────────────

// Apple App Attestation Root CA public key (P-256, raw 65 bytes uncompressed)
// Extracted from: https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// This is the SPKI-decoded raw EC point for verification of the intermediate cert.
// NOTE: In production, embed the full root CA cert and validate the chain properly.
// For now we validate the attestation structure and extract the credential key.

// App identities: TEAM_ID + "." + BUNDLE_ID
// Both the main app and keyboard extension can attest independently
const APP_IDS = [
  "TCU64E3XV4.io.keywitness.app",
  "TCU64E3XV4.io.keywitness.app.keyboard",
];

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
  const signCount = new DataView(new Uint8Array(data.slice(33, 37)).buffer as ArrayBuffer).getUint32(0);

  const result: AuthData = { rpIdHash, flags, signCount };

  // If attested credential data is present (bit 6 of flags)
  // Only parse if there's enough data — assertions are 37 bytes and never have credential data
  if ((flags & 0x40) && data.length > 55) {
    // AAGUID (16 bytes) at offset 37
    const credIdLength = new DataView(new Uint8Array(data.slice(53, 55)).buffer as ArrayBuffer).getUint16(0);
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

// ── Debug: list credentials ──────────────────────────────────────────────────

export const listCredentials = query({
  args: {},
  handler: async (ctx) => {
    const creds = await ctx.db.query("appAttestCredentials").collect();
    return creds.map((c) => ({
      keyId: c.keyId,
      linkedEd25519Key: c.linkedEd25519Key,
      counter: c.counter,
      createdAt: c.createdAt,
    }));
  },
});

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

    // 5. Verify RP ID hash matches one of the allowed APP_IDs
    const rpIdHex = toHex(parsed.rpIdHash);
    let rpIdMatch = false;
    for (const appId of APP_IDS) {
      const expected = await sha256(new TextEncoder().encode(appId));
      if (rpIdHex === toHex(expected)) { rpIdMatch = true; break; }
    }
    if (!rpIdMatch) {
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
    if (!credential) throw new Error("Unknown App Attest key ID: " + args.keyId);

    // 2. Decode assertion CBOR
    const assertionBytes = base64urlDecode(args.assertion);
    let assertionObj: Record<string, unknown>;
    try {
      assertionObj = cborg.decode(assertionBytes) as Record<string, unknown>;
    } catch {
      throw new Error("Failed to decode assertion CBOR");
    }

    const rawSignature = assertionObj.signature as Uint8Array;
    const rawAuthData = assertionObj.authenticatorData as Uint8Array;
    if (!rawSignature || !rawAuthData) {
      throw new Error("Missing signature or authenticatorData in assertion");
    }

    // Copy to clean Uint8Arrays (CBOR decoder may return views with non-zero byteOffset)
    const signature = new Uint8Array(rawSignature);
    const authenticatorData = new Uint8Array(rawAuthData);

    console.log("verifyAssertion: authData length =", authenticatorData.length, "sig length =", signature.length);

    // 3. Parse authenticator data
    if (authenticatorData.length < 37) {
      throw new Error(`authenticatorData too short: ${authenticatorData.length} bytes (need >= 37)`);
    }
    const parsed = parseAuthData(authenticatorData);

    // 4. Verify RP ID hash matches one of the allowed APP_IDs
    const assertionRpIdHex = toHex(parsed.rpIdHash);
    let assertionRpIdMatch = false;
    for (const appId of APP_IDS) {
      const expected = await sha256(new TextEncoder().encode(appId));
      if (assertionRpIdHex === toHex(expected)) { assertionRpIdMatch = true; break; }
    }
    if (!assertionRpIdMatch) {
      throw new Error("RP ID hash mismatch in assertion (got " + assertionRpIdHex.slice(0, 16) + "...)");
    }

    // 5. Verify counter > stored counter (replay protection)
    if (parsed.signCount <= credential.counter) {
      throw new Error(`Assertion counter ${parsed.signCount} <= stored ${credential.counter}`);
    }

    // 6. Build the data that was signed: authenticatorData || SHA256(clientData)
    const clientDataHash = await sha256(new TextEncoder().encode(args.expectedClientData));
    const composite = new Uint8Array(authenticatorData.length + clientDataHash.length);
    composite.set(authenticatorData, 0);
    composite.set(clientDataHash, authenticatorData.length);
    const nonce = await sha256(composite);

    // 7. Verify ECDSA P-256 signature
    // Apple returns DER-encoded signatures; WebCrypto expects raw (r||s) format
    const rawSignatureBytes = derToRawEcdsa(signature);

    const rawKeyBytes = base64urlDecode(credential.credentialPublicKey);
    console.log("verifyAssertion: pubkey", toHex(new Uint8Array(rawKeyBytes)).slice(0, 20) + "...",
      "nonce", toHex(nonce).slice(0, 20) + "...",
      "rpIdHash", toHex(parsed.rpIdHash).slice(0, 16) + "...",
      "counter", parsed.signCount);

    const publicKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(rawKeyBytes).buffer as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    // Try both: composite (authData || clientDataHash) and nonce (SHA256 of that)
    // WebCrypto ECDSA with hash:SHA-256 auto-hashes the data parameter
    const validComposite = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      new Uint8Array(rawSignatureBytes).buffer as ArrayBuffer,
      new Uint8Array(composite).buffer as ArrayBuffer,
    );

    const validNonce = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      new Uint8Array(rawSignatureBytes).buffer as ArrayBuffer,
      new Uint8Array(nonce).buffer as ArrayBuffer,
    );

    console.log("verifyAssertion: validComposite =", validComposite, "validNonce =", validNonce);

    if (!validComposite && !validNonce) {
      // Also try with the original DER signature (in case WebCrypto accepts DER)
      const validDER = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        new Uint8Array(signature).buffer as ArrayBuffer,
        new Uint8Array(composite).buffer as ArrayBuffer,
      );
      const validDERNonce = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        new Uint8Array(signature).buffer as ArrayBuffer,
        new Uint8Array(nonce).buffer as ArrayBuffer,
      );
      console.log("verifyAssertion: validDER =", validDER, "validDERNonce =", validDERNonce);
      if (!validDER && !validDERNonce) {
        throw new Error("App Attest assertion signature verification failed");
      }
    }

    // 8. Update counter
    await ctx.db.patch(credential._id, { counter: parsed.signCount });

    console.log("verifyAssertion: SUCCESS for keyId", args.keyId.slice(0, 8) + "...", "counter now", parsed.signCount);
    return { verified: true };
  },
});

// ── DER ECDSA signature to raw (r||s) conversion ────────────────────────────

function derToRawEcdsa(der: Uint8Array): Uint8Array {
  // DER format: 0x30 <total_len> 0x02 <r_len> <r> 0x02 <s_len> <s>
  if (der[0] !== 0x30) throw new Error("Not a DER sequence");
  let offset = 2; // skip 0x30 and length byte
  // Handle multi-byte length
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);

  // Read r
  if (der[offset] !== 0x02) throw new Error("Expected INTEGER tag for r");
  const rLen = der[offset + 1];
  const rStart = offset + 2;
  let r = der.slice(rStart, rStart + rLen);
  offset = rStart + rLen;

  // Read s
  if (der[offset] !== 0x02) throw new Error("Expected INTEGER tag for s");
  const sLen = der[offset + 1];
  const sStart = offset + 2;
  let s = der.slice(sStart, sStart + sLen);

  // Remove leading zero padding (DER integers are signed, so a leading 0x00 means positive)
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);

  // Pad to 32 bytes if shorter
  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(s, 64 - s.length);
  return raw;
}

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
