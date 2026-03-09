import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  attestations: defineTable({
    shortId: v.string(),
    attestation: v.string(),
    createdAt: v.number(),
    biometricSignature: v.optional(v.string()),   // Ed25519 sig of "keywitness:biometric:<shortId>"
    biometricPublicKey: v.optional(v.string()),    // base64url public key that signed it
    biometricTimestamp: v.optional(v.number()),     // Date.now() when biometric was verified
  }).index("by_shortId", ["shortId"]),
  keys: defineTable({
    publicKey: v.string(),      // base64url-encoded Ed25519 public key
    name: v.string(),           // display name (e.g. "Seth's iPhone")
    registeredAt: v.number(),   // Date.now()
  }).index("by_publicKey", ["publicKey"]),
});
