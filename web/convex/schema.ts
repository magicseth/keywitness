import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  attestations: defineTable({
    shortId: v.string(),
    attestation: v.string(),
    createdAt: v.number(),
    biometricSignature: v.optional(v.string()),
    biometricPublicKey: v.optional(v.string()),
    biometricTimestamp: v.optional(v.number()),
    deviceVerified: v.optional(v.boolean()),
  }).index("by_shortId", ["shortId"]),
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
    credentialPublicKey: v.string(),   // base64url P-256 public key (raw, 65 bytes uncompressed)
    linkedEd25519Key: v.string(),      // The Ed25519 public key this device key is linked to
    counter: v.number(),               // Assertion counter for replay protection
    createdAt: v.number(),
  }).index("by_keyId", ["keyId"])
    .index("by_linkedEd25519Key", ["linkedEd25519Key"]),
});
