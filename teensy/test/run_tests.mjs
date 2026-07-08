/**
 * Verifies that the C attestation builder (attestation_v1.cpp — the code the
 * Teensy actually runs) produces bytes the KeyWitness server will accept.
 *
 * 1. Compiles attestation_v1.cpp natively.
 * 2. For each test vector, compares the C signing payload byte-for-byte with
 *    the server's JCS canonicalization (the `canonicalize` npm package used
 *    by web/convex/lib/verify.ts).
 * 3. Signs with tweetnacl, has the C code assemble the full attestation
 *    block, wraps it in PEM armor exactly like the ESP32 bridge does, and
 *    runs it through the REAL server verifier: verifyAttestationServerSide().
 * 4. Tamper test: modified cleartext must fail verification.
 *
 * Run:  npm install && npm test        (in teensy/test/)
 *       (web/ must also have node_modules: cd web && npm install)
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import nacl from "tweetnacl";
import canonicalize from "canonicalize";
import { verifyAttestationServerSide } from "../../web/convex/lib/verify.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");

// ── Preflight ────────────────────────────────────────────────────────────

if (!fs.existsSync(path.join(repo, "web", "node_modules"))) {
  console.error("web/node_modules missing — run `npm install` in web/ first");
  process.exit(1);
}

// ── Compile the device code natively ────────────────────────────────────

const buildDir = path.join(here, "build");
fs.mkdirSync(buildDir, { recursive: true });
const bin = path.join(buildDir, "kw_test");

console.log("Compiling attestation_v1.cpp ...");
execFileSync("cc", [
  "-Wall", "-Wextra", "-Werror",
  "-o", bin,
  path.join(here, "test_main.c"),
  path.join(here, "..", "KeyWitnessForward", "attestation_v1.cpp"),
], { stdio: "inherit" });

function runC(mode, fields) {
  const stdin = Buffer.concat(
    fields.map((f) => Buffer.concat([Buffer.from(f, "utf8"), Buffer.from([0])])),
  );
  return execFileSync(bin, [mode], { input: stdin, maxBuffer: 16 * 1024 * 1024 });
}

// ── Test vectors ─────────────────────────────────────────────────────────

const DEVICE_ID = "TEENSY4-64EC3A1B00C0FFEE";
const TIMESTAMP = "2026-07-07T20:14:03.000Z";
const BIO_HASH =
  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";

const CLEARTEXTS = [
  ["plain", "I hereby attest that I typed this myself."],
  ["quotes+backslash", 'He said "attest \\ verify" twice'],
  ["newline+tab", "line one\nline two\ttabbed"],
  ["control chars", "bell\x07 esc\x1b unit\x1f end"],
  ["unicode", "signed by Seth — café \u{1F511}⌨️"],
  ["json-ish", '{"cleartext":"fake","version":9}'],
  ["empty", ""],
];

// Deterministic test key (test-only, obviously)
const seed = Buffer.alloc(32, 7);
const keyPair = nacl.sign.keyPair.fromSeed(seed);
const pubHex = Buffer.from(keyPair.publicKey).toString("hex");

const pemWrap = (b64) =>
  `-----BEGIN KEYWITNESS ATTESTATION-----\n${b64}\n-----END KEYWITNESS ATTESTATION-----`;

let failures = 0;
const fail = (name, msg) => {
  failures++;
  console.error(`  FAIL [${name}] ${msg}`);
};

// ── 1. base64url matches Node ────────────────────────────────────────────

console.log("\nbase64url vs Node.js:");
for (const len of [0, 1, 2, 3, 31, 32, 64, 500]) {
  const bytes = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff));
  const got = runC("b64", [bytes.toString("hex")]).toString();
  const want = bytes.toString("base64url");
  if (got !== want) fail(`b64 len=${len}`, `got ${got} want ${want}`);
  else console.log(`  ok  len=${len}`);
}

// ── 2. signing payload matches server JCS canonicalization ───────────────

console.log("\nsigning payload vs JCS canonicalize():");
for (const [name, cleartext] of CLEARTEXTS) {
  const cPayload = runC("payload", [cleartext, DEVICE_ID, TIMESTAMP, BIO_HASH]);
  const jcs = Buffer.from(
    canonicalize({
      cleartext,
      deviceId: DEVICE_ID,
      keystrokeBiometricsHash: BIO_HASH,
      timestamp: TIMESTAMP,
      version: 1,
    }),
    "utf8",
  );
  if (!cPayload.equals(jcs)) {
    fail(name, `byte mismatch\n    C:   ${cPayload}\n    JCS: ${jcs}`);
  } else {
    console.log(`  ok  ${name}`);
  }
}

// ── 3. end-to-end: C-built block passes the real server verifier ─────────

console.log("\nfull attestation vs verifyAttestationServerSide():");
for (const [name, cleartext] of CLEARTEXTS) {
  const fields = [cleartext, DEVICE_ID, TIMESTAMP, BIO_HASH];
  const payload = runC("payload", fields);
  const sig = nacl.sign.detached(new Uint8Array(payload), keyPair.secretKey);
  const sigHex = Buffer.from(sig).toString("hex");

  const b64 = runC("block", [...fields, sigHex, pubHex]).toString();
  const result = await verifyAttestationServerSide(pemWrap(b64));

  if (!result.valid) {
    fail(name, `server verifier rejected: ${result.error}`);
  } else if (result.version !== "v1") {
    fail(name, `expected v1, got ${result.version}`);
  } else if (result.deviceId !== DEVICE_ID) {
    fail(name, `deviceId mismatch: ${result.deviceId}`);
  } else {
    console.log(`  ok  ${name} (signer ${result.publicKeyFingerprint.slice(0, 11)}…)`);
  }
}

// ── 4. tampering must fail ───────────────────────────────────────────────

console.log("\ntamper detection:");
{
  const fields = ["original message", DEVICE_ID, TIMESTAMP, BIO_HASH];
  const payload = runC("payload", fields);
  const sig = nacl.sign.detached(new Uint8Array(payload), keyPair.secretKey);
  const sigHex = Buffer.from(sig).toString("hex");

  // Same signature, different cleartext
  const b64 = runC("block", [
    "tampered message", DEVICE_ID, TIMESTAMP, BIO_HASH, sigHex, pubHex,
  ]).toString();
  const result = await verifyAttestationServerSide(pemWrap(b64));
  if (result.valid) fail("tamper", "tampered attestation VERIFIED — bad!");
  else console.log("  ok  tampered cleartext rejected");
}

// ── Summary ──────────────────────────────────────────────────────────────

console.log(
  failures === 0
    ? "\nAll tests passed — device bytes are server-compatible."
    : `\n${failures} test(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
