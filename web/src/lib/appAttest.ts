/**
 * Client-side Apple App Attest verification.
 *
 * Verifies App Attest assertions independently using only the attestation
 * object (CBOR with X.509 cert chain) embedded in the VC. The only trust
 * anchor is Apple's App Attestation Root CA — no server required.
 *
 * Flow:
 * 1. Decode attestation object CBOR → extract x5c cert chain
 * 2. Verify cert chain: leaf → intermediate → Apple Root CA
 * 3. Extract P-256 public key from leaf cert
 * 4. Decode assertion CBOR → extract authenticatorData + signature
 * 5. Verify P-256 ECDSA signature over authenticatorData || SHA256(clientData)
 */
import * as cborg from "cborg";

// Apple App Attestation Root CA (DER, base64-encoded)
// Source: https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem
const APPLE_ROOT_CA_B64 =
  "MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYw" +
  "JAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwK" +
  "QXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNa" +
  "Fw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlv" +
  "biBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9y" +
  "bmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdh" +
  "NbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9au" +
  "Yen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/" +
  "MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYw" +
  "CgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn" +
  "53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijV" +
  "oyFraWVIyd/dganmrduC1bmTBGwD";

// Known App IDs (team ID + bundle ID)
const APP_IDS = [
  "TCU64E3XV4.io.keywitness.app",
  "TCU64E3XV4.io.keywitness.app.keyboard",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64Decode(input: string): Uint8Array {
  const bin = atob(input);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function b64urlDecode(input: string): Uint8Array {
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  return b64Decode(b64);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", toArrayBuffer(data));
  return new Uint8Array(hash);
}

// ── ASN.1 DER parsing ────────────────────────────────────────────────────────

interface DERNode {
  tag: number;
  offset: number;
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
  const cert = parseDERAt(certDER, 0);
  const certChildren = getDERChildren(certDER, cert);
  if (certChildren.length < 3) throw new Error("Invalid X.509 certificate structure");
  const tbsRaw = getDERRaw(certDER, certChildren[0]);
  const sigAlgChildren = getDERChildren(certDER, certChildren[1]);
  const signatureAlgOID = getDERContents(certDER, sigAlgChildren[0]);
  const sigBitString = getDERContents(certDER, certChildren[2]);
  const signatureValue = sigBitString.slice(1);
  const tbsChildren = getDERChildren(certDER, certChildren[0]);
  const spkiIndex = tbsChildren[0].tag === 0xa0 ? 6 : 5;
  const spkiRaw = getDERRaw(certDER, tbsChildren[spkiIndex]);
  return { tbsRaw, signatureAlgOID, signatureValue, spkiRaw };
}

function getCurveFromSPKI(spki: Uint8Array): string {
  const spkiNode = parseDERAt(spki, 0);
  const children = getDERChildren(spki, spkiNode);
  const algIdNode = children[0];
  const algIdChildren = getDERChildren(spki, algIdNode);
  const curveOID = toHex(getDERContents(spki, algIdChildren[1]));
  if (curveOID === "2a8648ce3d030107") return "P-256";
  if (curveOID === "2b81040022") return "P-384";
  throw new Error("Unsupported EC curve OID: " + curveOID);
}

function getHashForSigAlg(oid: Uint8Array): string {
  const hex = toHex(oid);
  if (hex === "2a8648ce3d040302") return "SHA-256";
  if (hex === "2a8648ce3d040303") return "SHA-384";
  if (hex === "2a8648ce3d040304") return "SHA-512";
  throw new Error("Unsupported signature algorithm OID: " + hex);
}

function extractRawKeyFromSPKI(spki: Uint8Array): Uint8Array {
  const spkiNode = parseDERAt(spki, 0);
  const children = getDERChildren(spki, spkiNode);
  const bitString = getDERContents(spki, children[1]);
  return bitString.slice(1);
}

function derToRawEcdsa(der: Uint8Array, componentSize = 32): Uint8Array {
  if (der[0] !== 0x30) throw new Error("Not a DER sequence");
  let offset = 2;
  if (der[1] & 0x80) offset = 2 + (der[1] & 0x7f);
  if (der[offset] !== 0x02) throw new Error("Expected INTEGER tag for r");
  const rLen = der[offset + 1];
  const rStart = offset + 2;
  let r = der.slice(rStart, rStart + rLen);
  offset = rStart + rLen;
  if (der[offset] !== 0x02) throw new Error("Expected INTEGER tag for s");
  const sLen = der[offset + 1];
  const sStart = offset + 2;
  let s = der.slice(sStart, sStart + sLen);
  while (r.length > componentSize && r[0] === 0) r = r.slice(1);
  while (s.length > componentSize && s[0] === 0) s = s.slice(1);
  const raw = new Uint8Array(componentSize * 2);
  raw.set(r, componentSize - r.length);
  raw.set(s, componentSize * 2 - s.length);
  return raw;
}

// ── X.509 cert chain verification ────────────────────────────────────────────

async function verifyX509CertChain(x5c: Uint8Array[]): Promise<Uint8Array> {
  if (x5c.length < 2) throw new Error("x5c chain must have at least 2 certificates");

  const leafInfo = parseX509(x5c[0]);
  const intermediateInfo = parseX509(x5c[1]);

  // 1. Verify intermediate cert is signed by Apple Root CA
  const rootCertDER = b64Decode(APPLE_ROOT_CA_B64);
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

  return extractRawKeyFromSPKI(leafInfo.spkiRaw);
}

// ── Authenticator data parsing ───────────────────────────────────────────────

interface AuthData {
  rpIdHash: Uint8Array;
  flags: number;
  signCount: number;
  credentialId?: Uint8Array;
  credentialPublicKey?: Uint8Array;
}

function parseAuthData(data: Uint8Array): AuthData {
  const rpIdHash = data.slice(0, 32);
  const flags = data[32];
  const signCount = new DataView(new Uint8Array(data.slice(33, 37)).buffer as ArrayBuffer).getUint32(0);
  const result: AuthData = { rpIdHash, flags, signCount };
  if ((flags & 0x40) && data.length > 55) {
    const credIdLength = new DataView(new Uint8Array(data.slice(53, 55)).buffer as ArrayBuffer).getUint16(0);
    result.credentialId = data.slice(55, 55 + credIdLength);
    result.credentialPublicKey = data.slice(55 + credIdLength);
  }
  return result;
}

function coseKeyToRawP256(coseBytes: Uint8Array): Uint8Array {
  const coseKey = cborg.decode(coseBytes, { useMaps: true }) as Map<number, unknown>;
  const x = coseKey.get(-2) as Uint8Array;
  const y = coseKey.get(-3) as Uint8Array;
  if (!x || !y || x.length !== 32 || y.length !== 32) {
    throw new Error("Invalid COSE key: missing or wrong-sized x/y coordinates");
  }
  const raw = new Uint8Array(65);
  raw[0] = 0x04;
  raw.set(x, 1);
  raw.set(y, 33);
  return raw;
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AppAttestVerificationResult {
  valid: boolean;
  error?: string;
  leafPublicKey?: string; // hex
}

/**
 * Verify an App Attest assertion independently using the embedded attestation object.
 *
 * @param attestationObjectB64 - base64url CBOR attestation object (from Apple, contains x5c cert chain)
 * @param assertionDataB64 - base64url CBOR assertion (per-request signature)
 * @param clientData - the string the assertion was generated over
 */
export async function verifyAppAttestIndependently(
  attestationObjectB64: string,
  assertionDataB64: string,
  clientData: string,
): Promise<AppAttestVerificationResult> {
  try {
    // 1. Decode attestation object → get x5c cert chain + credential public key
    const attestationBytes = b64urlDecode(attestationObjectB64);
    const attestationObj = cborg.decode(attestationBytes) as Record<string, unknown>;

    const fmt = attestationObj.fmt as string;
    if (fmt !== "apple-appattest") {
      return { valid: false, error: `Unexpected attestation format: ${fmt}` };
    }

    const attStmt = attestationObj.attStmt as Record<string, unknown>;
    const authData = attestationObj.authData as Uint8Array;
    if (!attStmt || !authData) {
      return { valid: false, error: "Missing attStmt or authData in attestation object" };
    }

    // 2. Parse auth data → get credential public key
    const parsed = parseAuthData(authData);

    // Verify RP ID hash matches known app IDs
    const rpIdHex = toHex(parsed.rpIdHash);
    let rpIdMatch = false;
    for (const appId of APP_IDS) {
      const expected = await sha256(new TextEncoder().encode(appId));
      if (rpIdHex === toHex(expected)) { rpIdMatch = true; break; }
    }
    if (!rpIdMatch) {
      return { valid: false, error: "RP ID hash mismatch — not from a KeyWitness app" };
    }

    if (!parsed.credentialPublicKey) {
      return { valid: false, error: "No credential public key in attestation" };
    }
    const credentialP256Key = coseKeyToRawP256(parsed.credentialPublicKey);

    // 3. Verify x5c cert chain → Apple Root CA
    const x5c = attStmt.x5c as Uint8Array[];
    if (!x5c || x5c.length < 2) {
      return { valid: false, error: "Missing x5c certificate chain" };
    }

    const leafPublicKeyRaw = await verifyX509CertChain(x5c);

    // 4. Verify leaf cert's public key matches credential key in authData
    if (toHex(leafPublicKeyRaw) !== toHex(credentialP256Key)) {
      return { valid: false, error: "Leaf certificate public key does not match credential key" };
    }

    // 5. Decode assertion CBOR
    const assertionBytes = b64urlDecode(assertionDataB64);
    const assertionObj = cborg.decode(assertionBytes) as Record<string, unknown>;
    const rawSignature = assertionObj.signature as Uint8Array;
    const rawAuthenticatorData = assertionObj.authenticatorData as Uint8Array;
    if (!rawSignature || !rawAuthenticatorData) {
      return { valid: false, error: "Missing signature or authenticatorData in assertion" };
    }

    const signature = new Uint8Array(rawSignature);
    const authenticatorData = new Uint8Array(rawAuthenticatorData);

    // 6. Build signed data: authenticatorData || SHA256(clientData)
    const clientDataHash = await sha256(new TextEncoder().encode(clientData));
    const composite = new Uint8Array(authenticatorData.length + clientDataHash.length);
    composite.set(authenticatorData, 0);
    composite.set(clientDataHash, authenticatorData.length);

    // 7. Import the P-256 public key from the verified cert chain
    const publicKey = await crypto.subtle.importKey(
      "raw",
      toArrayBuffer(leafPublicKeyRaw),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    // 8. Verify ECDSA P-256 signature (try raw and DER formats)
    const rawSig = derToRawEcdsa(signature);

    const validComposite = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      toArrayBuffer(new Uint8Array(rawSig)),
      toArrayBuffer(composite),
    );

    if (validComposite) {
      return { valid: true, leafPublicKey: toHex(leafPublicKeyRaw) };
    }

    // Try with nonce = SHA256(composite)
    const nonce = await sha256(composite);
    const validNonce = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      toArrayBuffer(new Uint8Array(rawSig)),
      toArrayBuffer(nonce),
    );

    if (validNonce) {
      return { valid: true, leafPublicKey: toHex(leafPublicKeyRaw) };
    }

    // Try DER signature directly
    const validDER = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      toArrayBuffer(new Uint8Array(signature)),
      toArrayBuffer(composite),
    );

    if (validDER) {
      return { valid: true, leafPublicKey: toHex(leafPublicKeyRaw) };
    }

    return { valid: false, error: "App Attest assertion signature verification failed" };
  } catch (e) {
    return { valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}
