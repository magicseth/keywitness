import { mutation, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import * as cborg from "cborg";
import nacl from "tweetnacl";

// ── Constants ────────────────────────────────────────────────────────────────

// App identities: TEAM_ID + "." + BUNDLE_ID
// Both the main app and keyboard extension can attest independently
const APP_IDS = [
  "TCU64E3XV4.io.keywitness.app",
  "TCU64E3XV4.io.keywitness.app.keyboard",
];

// Apple App Attestation Root CA (DER, base64-encoded)
// Source: https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
// Verify this matches the cert downloaded from Apple's Certificate Authority page.
// This is a P-384 self-signed root certificate.
const APPLE_APP_ATTESTATION_ROOT_CA_BASE64 =
  "MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw" +
  "JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK" +
  "QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa" +
  "Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv" +
  "biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y" +
  "bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh" +
  "NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDnzczMhp5pCLvg57bGhXi3aok0B+bXp+TYb" +
  "Lhke/7PaYCo5N2O5IyQ0MBLK6i+D3tCJaub/o0IwQDAPBgNVHRMBAf8EBTADAQH/" +
  "MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw" +
  "CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn" +
  "53O5+FRXgeLhd6gN04LK3t/yAjEAi/V0p2SFiMKSGO+xjG7ax33X2DWZQ3e/sHqz" +
  "HuUyj0EtMoMGjQ9laIE9YuML2gRD";

// ── Base64 helpers ───────────────────────────────────────────────────────────

function base64Decode(input: string): Uint8Array {
  const binaryString = atob(input);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function base64urlDecode(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  return base64Decode(base64);
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

// ── Minimal ASN.1 DER parser for X.509 certificate chain validation ──────────

interface DERNode {
  tag: number;
  offset: number;       // absolute offset in the data
  headerLen: number;
  contentLen: number;
  totalLen: number;
}

function parseDERAt(data: Uint8Array, offset: number): DERNode {
  const tag = data[offset];
  let headerLen: number;
  let contentLen: number;

  const lenByte = data[offset + 1];
  if (lenByte & 0x80) {
    const numLenBytes = lenByte & 0x7f;
    contentLen = 0;
    for (let i = 0; i < numLenBytes; i++) {
      contentLen = (contentLen << 8) | data[offset + 2 + i];
    }
    headerLen = 2 + numLenBytes;
  } else {
    contentLen = lenByte;
    headerLen = 2;
  }

  return { tag, offset, headerLen, contentLen, totalLen: headerLen + contentLen };
}

function getDERChildren(data: Uint8Array, parent: DERNode): DERNode[] {
  const children: DERNode[] = [];
  let pos = parent.offset + parent.headerLen;
  const end = pos + parent.contentLen;
  while (pos < end) {
    const child = parseDERAt(data, pos);
    children.push(child);
    pos += child.totalLen;
  }
  return children;
}

function getDERContents(data: Uint8Array, node: DERNode): Uint8Array {
  return data.slice(node.offset + node.headerLen, node.offset + node.totalLen);
}

function getDERRaw(data: Uint8Array, node: DERNode): Uint8Array {
  return data.slice(node.offset, node.offset + node.totalLen);
}

// ── X.509 certificate parsing ────────────────────────────────────────────────

interface X509CertParts {
  tbsRaw: Uint8Array;
  signatureAlgOID: Uint8Array;
  signatureValue: Uint8Array;
  spkiRaw: Uint8Array;
}

function parseX509(certDER: Uint8Array): X509CertParts {
  // Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }
  const cert = parseDERAt(certDER, 0);
  const certChildren = getDERChildren(certDER, cert);
  if (certChildren.length < 3) throw new Error("Invalid X.509 certificate structure");

  // TBS Certificate (raw bytes including SEQUENCE header for signature verification)
  const tbsRaw = getDERRaw(certDER, certChildren[0]);

  // Signature Algorithm — SEQUENCE { OID, ... }
  const sigAlgChildren = getDERChildren(certDER, certChildren[1]);
  const signatureAlgOID = getDERContents(certDER, sigAlgChildren[0]);

  // Signature Value — BIT STRING (first byte = unused bits count, usually 0)
  const sigBitString = getDERContents(certDER, certChildren[2]);
  const signatureValue = sigBitString.slice(1);

  // Extract SPKI from TBS
  const tbsChildren = getDERChildren(certDER, certChildren[0]);
  // TBS: [version [0] EXPLICIT], serialNumber, signature, issuer, validity, subject, SPKI
  const spkiIndex = tbsChildren[0].tag === 0xa0 ? 6 : 5;
  const spkiRaw = getDERRaw(certDER, tbsChildren[spkiIndex]);

  return { tbsRaw, signatureAlgOID, signatureValue, spkiRaw };
}

function getCurveFromSPKI(spki: Uint8Array): string {
  const spkiNode = parseDERAt(spki, 0);
  const children = getDERChildren(spki, spkiNode);
  // AlgorithmIdentifier SEQUENCE { OID ecPublicKey, OID curve }
  const algIdNode = children[0];
  const algIdChildren = getDERChildren(spki, algIdNode);
  const curveOID = toHex(getDERContents(spki, algIdChildren[1]));
  if (curveOID === "2a8648ce3d030107") return "P-256";
  if (curveOID === "2b81040022") return "P-384";
  throw new Error("Unsupported EC curve OID: " + curveOID);
}

function getHashForSigAlg(oid: Uint8Array): string {
  const hex = toHex(oid);
  // ecdsaWithSHA256: 1.2.840.10045.4.3.2
  if (hex === "2a8648ce3d040302") return "SHA-256";
  // ecdsaWithSHA384: 1.2.840.10045.4.3.3
  if (hex === "2a8648ce3d040303") return "SHA-384";
  // ecdsaWithSHA512: 1.2.840.10045.4.3.4
  if (hex === "2a8648ce3d040304") return "SHA-512";
  throw new Error("Unsupported signature algorithm OID: " + hex);
}

function extractRawKeyFromSPKI(spki: Uint8Array): Uint8Array {
  const spkiNode = parseDERAt(spki, 0);
  const children = getDERChildren(spki, spkiNode);
  // SPKI: SEQUENCE { AlgorithmIdentifier, BIT STRING { 0x00 || uncompressed_point } }
  const bitString = getDERContents(spki, children[1]);
  return bitString.slice(1); // skip unused bits byte
}

/**
 * Verify the x5c certificate chain from leaf → intermediate → Apple Root CA.
 * Returns the leaf certificate's raw EC public key (uncompressed point).
 */
async function verifyX509CertChain(x5c: Uint8Array[]): Promise<Uint8Array> {
  if (x5c.length < 2) throw new Error("x5c chain must have at least 2 certificates");

  const leafInfo = parseX509(x5c[0]);
  const intermediateInfo = parseX509(x5c[1]);

  // 1. Verify intermediate cert is signed by Apple Root CA
  const rootCertDER = base64Decode(APPLE_APP_ATTESTATION_ROOT_CA_BASE64);
  const rootInfo = parseX509(rootCertDER);
  const rootCurve = getCurveFromSPKI(rootInfo.spkiRaw);
  const rootComponentSize = rootCurve === "P-384" ? 48 : 32;

  const rootKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(rootInfo.spkiRaw),
    { name: "ECDSA", namedCurve: rootCurve },
    false,
    ["verify"],
  );

  const intHash = getHashForSigAlg(intermediateInfo.signatureAlgOID);
  const intSigRaw = derToRawEcdsa(intermediateInfo.signatureValue, rootComponentSize);

  const intermediateValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: intHash },
    rootKey,
    toArrayBuffer(new Uint8Array(intSigRaw)),
    toArrayBuffer(intermediateInfo.tbsRaw),
  );
  if (!intermediateValid) {
    throw new Error("Intermediate certificate not signed by Apple App Attestation Root CA");
  }

  // 2. Verify leaf cert is signed by intermediate
  const intCurve = getCurveFromSPKI(intermediateInfo.spkiRaw);
  const intComponentSize = intCurve === "P-384" ? 48 : 32;

  const intKey = await crypto.subtle.importKey(
    "spki",
    toArrayBuffer(intermediateInfo.spkiRaw),
    { name: "ECDSA", namedCurve: intCurve },
    false,
    ["verify"],
  );

  const leafHash = getHashForSigAlg(leafInfo.signatureAlgOID);
  const leafSigRaw = derToRawEcdsa(leafInfo.signatureValue, intComponentSize);

  const leafValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: leafHash },
    intKey,
    toArrayBuffer(new Uint8Array(leafSigRaw)),
    toArrayBuffer(leafInfo.tbsRaw),
  );
  if (!leafValid) {
    throw new Error("Leaf certificate not signed by intermediate certificate");
  }

  // 3. Return the leaf's raw public key
  return extractRawKeyFromSPKI(leafInfo.spkiRaw);
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
    publicKey: v.string(),       // Ed25519 public key to link (base64url)
    publicKeySignature: v.string(), // Ed25519 signature over challenge (proof of possession)
  },
  handler: async (ctx, args) => {
    // 0. Verify proof-of-possession: the caller must prove they hold the Ed25519 private key
    const pubKeyBytes = base64urlDecode(args.publicKey);
    const sigBytes = base64urlDecode(args.publicKeySignature);
    if (pubKeyBytes.length !== 32) throw new Error("Invalid Ed25519 public key length");
    if (sigBytes.length !== 64) throw new Error("Invalid Ed25519 signature length");
    const challengeBytes = new TextEncoder().encode(args.challenge);
    const popValid = nacl.sign.detached.verify(challengeBytes, sigBytes, pubKeyBytes);
    if (!popValid) {
      throw new Error("Ed25519 proof-of-possession failed — cannot prove ownership of public key");
    }

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

    const x5c = attStmt.x5c as Uint8Array[];
    if (!x5c || x5c.length < 2) {
      throw new Error("Missing x5c certificate chain");
    }

    // Extract nonce from the leaf certificate
    const leafCert = x5c[0];
    const nonceFromCert = extractNonceFromCert(leafCert);
    if (!nonceFromCert) {
      throw new Error("Could not extract nonce from leaf certificate");
    }
    if (toHex(nonceFromCert) !== toHex(expectedNonce)) {
      throw new Error("Nonce mismatch — attestation binding failed");
    }

    // 9. Verify x5c certificate chain: leaf → intermediate → Apple Root CA
    const leafPublicKeyRaw = await verifyX509CertChain(x5c);

    // 10. Verify the leaf cert's public key matches the credential key in authData
    if (toHex(leafPublicKeyRaw) !== toHex(rawP256Key)) {
      throw new Error("Leaf certificate public key does not match credential key in authData");
    }

    // 11. Store the credential
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
      throw new Error("RP ID hash mismatch in assertion");
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
    const rawSignatureBytes = derToRawEcdsa(signature);

    const rawKeyBytes = base64urlDecode(credential.credentialPublicKey);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(rawKeyBytes).buffer as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

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

    if (!validComposite && !validNonce) {
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
      if (!validDER && !validDERNonce) {
        throw new Error("App Attest assertion signature verification failed");
      }
    }

    // 8. Update counter
    await ctx.db.patch(credential._id, { counter: parsed.signCount });

    return { verified: true, linkedEd25519Key: credential.linkedEd25519Key };
  },
});

// ── Session-based assertion verification (permanent device tokens) ────────────

export const verifySessionAssertion = internalMutation({
  args: {
    keyId: v.string(),
    assertion: v.string(),
    expectedClientData: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate session token format:
    //   keywitness:session:BASE64URL_PUBKEY (current)
    //   keywitness:session:YYYY-MM-DD:BASE64URL_PUBKEY (legacy, still accepted)
    //   keywitness:session:YYYY-MM-DD (legacy, still accepted)
    const sessionMatch = args.expectedClientData.match(/^keywitness:session:(?:\d{4}-\d{2}-\d{2}:?)?([A-Za-z0-9_-]+)?$/);
    if (!sessionMatch) throw new Error("Not a valid session token format");

    // Look up credential
    const credential = await ctx.db
      .query("appAttestCredentials")
      .withIndex("by_keyId", (q) => q.eq("keyId", args.keyId))
      .first();
    if (!credential) throw new Error("Unknown App Attest key ID: " + args.keyId);

    // Verify the Ed25519 key in the session token matches the credential's linked key
    const embeddedPubkey = sessionMatch[1];
    if (embeddedPubkey && embeddedPubkey !== credential.linkedEd25519Key) {
      throw new Error("Session token Ed25519 key does not match credential's linked key");
    }

    // Decode assertion CBOR
    const assertionBytes = base64urlDecode(args.assertion);
    const assertionObj = cborg.decode(assertionBytes) as Record<string, unknown>;
    const rawSignature = assertionObj.signature as Uint8Array;
    const rawAuthData = assertionObj.authenticatorData as Uint8Array;
    if (!rawSignature || !rawAuthData) throw new Error("Missing signature or authenticatorData");

    const signature = new Uint8Array(rawSignature);
    const authenticatorData = new Uint8Array(rawAuthData);
    if (authenticatorData.length < 37) throw new Error("authenticatorData too short");

    const parsed = parseAuthData(authenticatorData);

    // Verify RP ID hash
    const rpIdHex = toHex(parsed.rpIdHash);
    let rpMatch = false;
    for (const appId of APP_IDS) {
      const expected = await sha256(new TextEncoder().encode(appId));
      if (rpIdHex === toHex(expected)) { rpMatch = true; break; }
    }
    if (!rpMatch) throw new Error("RP ID hash mismatch in session assertion");

    // Verify counter > stored counter (replay protection)
    if (parsed.signCount <= credential.counter) {
      throw new Error(`Session assertion counter ${parsed.signCount} <= stored ${credential.counter} (replay detected)`);
    }

    const clientDataHash = await sha256(new TextEncoder().encode(args.expectedClientData));
    const composite = new Uint8Array(authenticatorData.length + clientDataHash.length);
    composite.set(authenticatorData, 0);
    composite.set(clientDataHash, authenticatorData.length);
    const nonce = await sha256(composite);

    const rawKeyBytes = base64urlDecode(credential.credentialPublicKey);
    const publicKey = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(rawKeyBytes).buffer as ArrayBuffer,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    // Verify signature
    const rawSig = derToRawEcdsa(signature);
    const valid =
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, new Uint8Array(rawSig).buffer as ArrayBuffer, new Uint8Array(composite).buffer as ArrayBuffer) ||
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, new Uint8Array(rawSig).buffer as ArrayBuffer, new Uint8Array(nonce).buffer as ArrayBuffer) ||
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, new Uint8Array(signature).buffer as ArrayBuffer, new Uint8Array(composite).buffer as ArrayBuffer) ||
      await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, new Uint8Array(signature).buffer as ArrayBuffer, new Uint8Array(nonce).buffer as ArrayBuffer);

    if (!valid) throw new Error("Session assertion signature verification failed");

    // Update counter (prevents replay)
    await ctx.db.patch(credential._id, { counter: parsed.signCount });

    return { verified: true, linkedEd25519Key: credential.linkedEd25519Key };
  },
});

// ── DER ECDSA signature to raw (r||s) conversion ────────────────────────────

function derToRawEcdsa(der: Uint8Array, componentSize = 32): Uint8Array {
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
  while (r.length > componentSize && r[0] === 0) r = r.slice(1);
  while (s.length > componentSize && s[0] === 0) s = s.slice(1);

  // Pad to componentSize bytes if shorter
  const raw = new Uint8Array(componentSize * 2);
  raw.set(r, componentSize - r.length);
  raw.set(s, componentSize * 2 - s.length);
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
  const byteOffset = idx / 2 + APPLE_NONCE_OID.length;

  // Scan forward for a 32-byte OCTET STRING (tag 0x04, length 0x20)
  for (let i = byteOffset; i < certDer.length - 33; i++) {
    if (certDer[i] === 0x04 && certDer[i + 1] === 0x20) {
      return certDer.slice(i + 2, i + 34);
    }
  }
  return null;
}
