import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ── Core tables ────────────────────────────────────────────────────────────

  attestations: defineTable({
    shortId: v.string(),
    attestation: v.string(),
    /** SHA-256 hex hash of the attestation content for dedup */
    attestationHash: v.optional(v.string()),
    createdAt: v.number(),
    biometricSignature: v.optional(v.string()),
    biometricPublicKey: v.optional(v.string()),
    biometricTimestamp: v.optional(v.number()),
    deviceVerified: v.optional(v.boolean()),
    /** Index into the status bitstring for revocation checking */
    statusIndex: v.optional(v.number()),
    /** Username and sequential number for typed.by URLs */
    username: v.optional(v.string()),
    usernameSeq: v.optional(v.number()),
  }).index("by_shortId", ["shortId"])
    .index("by_attestationHash", ["attestationHash"])
    .index("by_username_seq", ["username", "usernameSeq"]),

  usernames: defineTable({
    username: v.string(),
    /** SHA-256 hash of the recovery email (hex). Never store plaintext. */
    emailHash: v.string(),
    /** Base64url Ed25519 public keys authorized for this username */
    publicKeys: v.array(v.string()),
    /** Next sequential attestation number */
    nextSeq: v.number(),
    createdAt: v.number(),
  }).index("by_username", ["username"]),

  keys: defineTable({
    publicKey: v.string(),
    name: v.string(),
    registeredAt: v.number(),
  }).index("by_publicKey", ["publicKey"]),

  appAttestChallenges: defineTable({
    challenge: v.string(),
    createdAt: v.number(),
    used: v.boolean(),
  }).index("by_challenge", ["challenge"]),

  appAttestCredentials: defineTable({
    keyId: v.string(),
    credentialPublicKey: v.string(),
    linkedEd25519Key: v.string(),
    counter: v.number(),
    createdAt: v.number(),
  }).index("by_keyId", ["keyId"])
    .index("by_linkedEd25519Key", ["linkedEd25519Key"]),

  // ── Trust & Revocation tables ──────────────────────────────────────────────

  /** App version trust — which app builds are trusted */
  appVersions: defineTable({
    version: v.string(),                       // semver e.g. "1.2.0"
    bundleId: v.optional(v.string()),          // e.g. "io.keywitness.app"
    trusted: v.boolean(),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_version", ["version"]),

  /** Global config (minimum app version, etc.) */
  appConfig: defineTable({
    key: v.string(),
    value: v.string(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Provider trust — dynamic registry of trusted attestation providers */
  providerTrust: defineTable({
    providerId: v.string(),                    // URL or did:key
    name: v.string(),
    trusted: v.boolean(),
    type: v.optional(v.string()),              // "software-keyboard", "hardware-keyboard", etc.
    platform: v.optional(v.string()),
    proofTypes: v.array(v.string()),
    signingAlgorithms: v.array(v.string()),
    contextUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    revocationReason: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_providerId", ["providerId"]),

  /** Key and credential revocations */
  revocations: defineTable({
    type: v.union(v.literal("ed25519"), v.literal("appAttest"), v.literal("provider")),
    identifier: v.string(),                    // base64url public key, App Attest keyId, or provider DID
    reason: v.string(),                        // "key_compromise", "superseded", "cessation", etc.
    revokedAt: v.number(),
    revokedBy: v.optional(v.string()),
  }).index("by_identifier", ["identifier"])
    .index("by_type", ["type"]),

  /**
   * BitstringStatusList — W3C credential status.
   * Each row is a status list credential covering up to 131,072 credentials.
   * The bitstring is GZIP'd and base64url-encoded per the spec.
   */
  statusLists: defineTable({
    listId: v.string(),                        // e.g. "1", "2", ...
    statusPurpose: v.string(),                 // "revocation" or "suspension"
    /** GZIP'd base64url-encoded bitstring. Minimum 16KB uncompressed (131,072 bits). */
    encodedList: v.string(),
    /** Next available index in this list */
    nextIndex: v.number(),
    updatedAt: v.number(),
  }).index("by_listId", ["listId"]),
});
