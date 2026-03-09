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
  args: { attestation: v.string() },
  handler: async (ctx, args) => {
    const shortId = generateShortId();
    await ctx.db.insert("attestations", {
      shortId,
      attestation: args.attestation,
      createdAt: Date.now(),
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
    return { attestation: doc.attestation, createdAt: doc.createdAt };
  },
});
