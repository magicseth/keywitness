/**
 * did:key encoding/decoding for Ed25519 and P-256 public keys.
 *
 * did:key is a self-resolving DID method — no registry or blockchain needed.
 * Format: did:key:<multibase(multicodec-prefix || raw-public-key)>
 *
 * Multicodec prefixes (varint-encoded):
 *   Ed25519: 0xed 0x01
 *   P-256:   0x80 0x24
 *
 * Multibase prefix: z = base58btc
 *
 * @module
 */

import bs58 from "bs58";

// Multicodec prefixes (varint-encoded)
const ED25519_PREFIX = new Uint8Array([0xed, 0x01]);
const P256_PREFIX = new Uint8Array([0x80, 0x24]);

/**
 * Encode an Ed25519 public key (32 bytes) as a did:key identifier.
 *
 * @example
 * ed25519ToDIDKey(publicKeyBytes) // "did:key:z6MkhaXg..."
 */
export function ed25519ToDIDKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 32) {
    throw new Error(`Ed25519 public key must be 32 bytes, got ${publicKey.length}`);
  }
  const prefixed = new Uint8Array(ED25519_PREFIX.length + publicKey.length);
  prefixed.set(ED25519_PREFIX, 0);
  prefixed.set(publicKey, ED25519_PREFIX.length);
  return `did:key:z${bs58.encode(prefixed)}`;
}

/**
 * Encode a P-256 public key (33 bytes compressed or 65 bytes uncompressed) as did:key.
 */
export function p256ToDIDKey(publicKey: Uint8Array): string {
  if (publicKey.length !== 33 && publicKey.length !== 65) {
    throw new Error(`P-256 public key must be 33 or 65 bytes, got ${publicKey.length}`);
  }
  const prefixed = new Uint8Array(P256_PREFIX.length + publicKey.length);
  prefixed.set(P256_PREFIX, 0);
  prefixed.set(publicKey, P256_PREFIX.length);
  return `did:key:z${bs58.encode(prefixed)}`;
}

/**
 * Decode a did:key identifier to extract the raw public key bytes and key type.
 */
export function decodeDIDKey(did: string): { keyType: "Ed25519" | "P-256"; publicKey: Uint8Array } {
  if (!did.startsWith("did:key:z")) {
    throw new Error(`Invalid did:key format: ${did}`);
  }
  const multibaseBody = did.slice("did:key:z".length);
  const decoded = bs58.decode(multibaseBody);

  if (decoded[0] === 0xed && decoded[1] === 0x01) {
    return { keyType: "Ed25519", publicKey: decoded.slice(2) };
  }
  if (decoded[0] === 0x80 && decoded[1] === 0x24) {
    return { keyType: "P-256", publicKey: decoded.slice(2) };
  }
  throw new Error(`Unknown multicodec prefix: 0x${decoded[0].toString(16)} 0x${decoded[1].toString(16)}`);
}

/**
 * Build the verification method ID from a did:key.
 * Format: did:key:z6Mk...#z6Mk...
 */
export function verificationMethodId(did: string): string {
  const fragment = did.slice("did:key:".length);
  return `${did}#${fragment}`;
}
