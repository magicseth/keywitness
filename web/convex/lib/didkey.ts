/**
 * did:key encoding/decoding — server-side port.
 * Keep in sync with src/lib/didkey.ts.
 */

import bs58 from "bs58";

const ED25519_MULTICODEC = new Uint8Array([0xed, 0x01]);

export function ed25519ToDIDKey(publicKey: Uint8Array): string {
  const prefixed = new Uint8Array(ED25519_MULTICODEC.length + publicKey.length);
  prefixed.set(ED25519_MULTICODEC, 0);
  prefixed.set(publicKey, ED25519_MULTICODEC.length);
  return `did:key:z${bs58.encode(prefixed)}`;
}

export function decodeDIDKey(did: string): { keyType: string; publicKey: Uint8Array } {
  if (!did.startsWith("did:key:z")) {
    throw new Error(`Invalid did:key format: ${did}`);
  }
  const decoded = bs58.decode(did.slice("did:key:z".length));
  if (decoded[0] === 0xed && decoded[1] === 0x01) {
    return { keyType: "Ed25519", publicKey: decoded.slice(2) };
  }
  if (decoded[0] === 0x80 && decoded[1] === 0x24) {
    return { keyType: "P-256", publicKey: decoded.slice(2) };
  }
  throw new Error(`Unknown multicodec prefix: 0x${decoded[0].toString(16)}${decoded[1].toString(16)}`);
}
