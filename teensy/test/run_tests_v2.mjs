/**
 * v2 (encrypted) verification. Proves the C v2 builder + the on-device
 * encryption format are accepted by the real server verifier, and that the
 * ciphertext decrypts back to the original with the URL-fragment key.
 *
 * The device encrypts with rweather GCM<AES256>; here we use WebCrypto to
 * produce the identical standard AES-256-GCM layout (IV(12) || ct || tag(16)),
 * which is the interop contract. We check:
 *   1. C v2 signing payload byte-matches the server's JCS canonicalization.
 *   2. A signed v2 block passes verifyAttestationServerSide (version v2).
 *   3. encryptedCleartext decrypts with the fragment key back to the cleartext.
 *   4. cleartextHash matches SHA-256(cleartext).
 *
 * Run: npm test   (runs this after the v1 suite)
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import nacl from "tweetnacl";
import canonicalize from "canonicalize";
import { verifyAttestationServerSide } from "../../web/convex/lib/verify.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "build", "kw_test");
if (!fs.existsSync(bin)) {
  console.error("build/kw_test missing — run `npm test` (v1 suite compiles it) first");
  process.exit(1);
}

const subtle = globalThis.crypto.subtle;
const b64url = (b) => Buffer.from(b).toString("base64url");
const sha256 = async (bytes) => new Uint8Array(await subtle.digest("SHA-256", bytes));

function runC(mode, fields) {
  const stdin = Buffer.concat(
    fields.map((f) => Buffer.concat([Buffer.from(f, "utf8"), Buffer.from([0])])),
  );
  return execFileSync(bin, [mode], { input: stdin, maxBuffer: 16 * 1024 * 1024 });
}

const DEVICE_ID = "TEENSY36-64EC3A1B00C0FFEE";
const TIMESTAMP = "2026-07-07T21:03:11.000Z";
const BIO_HASH = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const CLEARTEXTS = [
  ["plain", "This should NOT be visible on the website."],
  ["quotes", 'secret: "launch codes" & \\stuff\\'],
  ["unicode", "私は本当にこれを入力しました 🔐"],
  ["multiline", "line one\nline two\nsigned"],
];

const seed = Buffer.alloc(32, 7);
const keyPair = nacl.sign.keyPair.fromSeed(seed);
const pubHex = Buffer.from(keyPair.publicKey).toString("hex");

const pemWrap = (b64) =>
  `-----BEGIN KEYWITNESS ATTESTATION-----\n${b64}\n-----END KEYWITNESS ATTESTATION-----`;

let failures = 0;
const fail = (name, msg) => { failures++; console.error(`  FAIL [${name}] ${msg}`); };

console.log("v2 (encrypted) — payload match, server verify, decrypt round-trip:\n");

for (const [name, cleartext] of CLEARTEXTS) {
  // cleartextHash is over the RAW text (matches what the verify page recomputes
  // from inner.cleartext), NOT over the JSON wrapper.
  const cleartextHash = b64url(await sha256(new TextEncoder().encode(cleartext)));

  // The device encrypts a JSON object {"cleartext":...}, not the raw text —
  // the verify page JSON.parses the plaintext and reads .cleartext.
  const innerJSON = JSON.stringify({ cleartext, keystrokeTimings: [] });
  const innerBytes = new TextEncoder().encode(innerJSON);

  // Encrypt like the device: AES-256-GCM, 12-byte zero IV (unique key),
  // blob = IV || ciphertext || tag.
  const rawKey = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) rawKey[i] = (i * 53 + name.length) & 0xff; // deterministic per-test key
  const iv = new Uint8Array(12); // device uses zero IV with a unique key
  const cryptoKey = await subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  const ctTag = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, cryptoKey, innerBytes));
  const blob = new Uint8Array(12 + ctTag.length);
  blob.set(iv, 0);
  blob.set(ctTag, 12);
  const encryptedCleartext = b64url(blob);
  const keyB64 = b64url(rawKey);

  const fields = [cleartextHash, encryptedCleartext, DEVICE_ID, TIMESTAMP, BIO_HASH, "0"];

  // 1. C payload vs server JCS canonicalization.
  const cPayload = runC("payload_v2", fields);
  const jcs = Buffer.from(
    canonicalize({
      cleartextHash,
      deviceId: DEVICE_ID,
      encryptedCleartext,
      faceIdVerified: false,
      keystrokeBiometricsHash: BIO_HASH,
      timestamp: TIMESTAMP,
      version: "keywitness-v2",
    }),
    "utf8",
  );
  if (!cPayload.equals(jcs)) {
    fail(name, `payload mismatch\n    C:   ${cPayload}\n    JCS: ${jcs}`);
    continue;
  }

  // 2. Sign, build block, run the REAL server verifier.
  const sig = nacl.sign.detached(new Uint8Array(cPayload), keyPair.secretKey);
  const sigHex = Buffer.from(sig).toString("hex");
  const b64 = runC("block_v2", [...fields, sigHex, pubHex]).toString();
  const result = await verifyAttestationServerSide(pemWrap(b64));

  if (!result.valid) { fail(name, `server rejected: ${result.error}`); continue; }
  if (result.version !== "v2") { fail(name, `expected v2, got ${result.version}`); continue; }
  if (!result.encrypted) { fail(name, "server did not mark it encrypted"); continue; }

  // 3. Decrypt with the fragment key (what the verify page does).
  const parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  const blob2 = Buffer.from(parsed.encryptedCleartext, "base64url");
  const nonce = blob2.subarray(0, 12);
  const rest = blob2.subarray(12);
  const dkey = await subtle.importKey("raw", Buffer.from(keyB64, "base64url"), "AES-GCM", false, ["decrypt"]);
  let decryptedJSON;
  try {
    decryptedJSON = new TextDecoder().decode(await subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, dkey, rest));
  } catch (e) {
    fail(name, `decrypt failed: ${e.message}`); continue;
  }

  // Mirror the website exactly: JSON.parse the plaintext, read .cleartext.
  let inner;
  try { inner = JSON.parse(decryptedJSON); }
  catch (e) { fail(name, `plaintext is not JSON (this was the bug): ${JSON.stringify(decryptedJSON)}`); continue; }
  if (inner.cleartext !== cleartext) { fail(name, `inner.cleartext mismatch: ${JSON.stringify(inner.cleartext)}`); continue; }

  // 4. cleartextHash integrity — hash of inner.cleartext must match the envelope.
  const recomputed = b64url(await sha256(new TextEncoder().encode(inner.cleartext)));
  if (recomputed !== parsed.cleartextHash) { fail(name, "cleartextHash mismatch"); continue; }

  console.log(`  ok  ${name} — server verified v2, {"cleartext":…} decrypts + hash matches`);
}

console.log(
  failures === 0
    ? "\nv2 OK — cleartext is encrypted; only a hash + ciphertext upload; key rides in #fragment."
    : `\n${failures} v2 test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
