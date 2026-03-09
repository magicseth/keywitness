import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

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

    // Try to allocate a status index for BitstringStatusList revocation
    let statusIndex: number | undefined;
    try {
      const result = await ctx.scheduler.runAfter(0, internal.trust.allocateStatusIndex, { listId: "1" });
      void result; // fire and forget — we'll set it in a follow-up
    } catch {
      // Status list not initialized yet — skip. Attestation still works.
    }

    // Attempt synchronous status index allocation
    const list = await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", "1"))
      .first();
    if (list && list.nextIndex < 131072) {
      statusIndex = list.nextIndex;
      await ctx.db.patch(list._id, { nextIndex: list.nextIndex + 1 });
    }

    await ctx.db.insert("attestations", {
      shortId,
      attestation: args.attestation,
      createdAt: Date.now(),
      deviceVerified: args.deviceVerified || undefined,
      statusIndex,
    });
    return {
      id: shortId,
      url: `/v/${shortId}`,
      statusIndex,
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
      statusIndex: doc.statusIndex,
    };
  },
});

export const addBiometricVerification = mutation({
  args: {
    shortId: v.string(),
    signature: v.string(),
    publicKey: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("attestations")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();
    if (!doc) throw new Error("Attestation not found");
    if (doc.biometricSignature) throw new Error("Biometric already verified");

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
