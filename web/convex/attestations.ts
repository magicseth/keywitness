import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

function generateShortId(length = 10): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const upload = mutation({
  args: {
    attestation: v.string(),
    deviceVerified: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const shortId = generateShortId();
    await ctx.db.insert("attestations", {
      shortId,
      attestation: args.attestation,
      createdAt: Date.now(),
      deviceVerified: args.deviceVerified || undefined,
    });
    return {
      id: shortId,
      url: `/v/${shortId}`,
    };
  },
});

export const getByShortId = query({
  args: { shortId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("attestations")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();
    if (!doc) return null;
    return {
      attestation: doc.attestation,
      createdAt: doc.createdAt,
      biometricSignature: doc.biometricSignature,
      biometricPublicKey: doc.biometricPublicKey,
      biometricTimestamp: doc.biometricTimestamp,
      deviceVerified: doc.deviceVerified,
    };
  },
});

export const addBiometricVerification = mutation({
  args: {
    shortId: v.string(),
    signature: v.string(),   // base64url Ed25519 sig of "keywitness:biometric:<shortId>"
    publicKey: v.string(),   // base64url Ed25519 public key
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("attestations")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();
    if (!doc) throw new Error("Attestation not found");
    if (doc.biometricSignature) throw new Error("Biometric already verified");

    // Check that attestation is less than 60 seconds old
    const age = Date.now() - doc.createdAt;
    if (age > 60_000) throw new Error("Biometric verification window expired (60s)");

    await ctx.db.patch(doc._id, {
      biometricSignature: args.signature,
      biometricPublicKey: args.publicKey,
      biometricTimestamp: Date.now(),
    });
    return { success: true };
  },
});
