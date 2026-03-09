import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const register = mutation({
  args: {
    publicKey: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("keys")
      .withIndex("by_publicKey", (q) => q.eq("publicKey", args.publicKey))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { name: args.name });
      return { ...existing, name: args.name };
    }

    const record = {
      publicKey: args.publicKey,
      name: args.name,
      registeredAt: Date.now(),
    };
    const id = await ctx.db.insert("keys", record);
    return { _id: id, ...record };
  },
});

export const getByPublicKey = query({
  args: {
    publicKey: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("keys")
      .withIndex("by_publicKey", (q) => q.eq("publicKey", args.publicKey))
      .first();
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("keys").collect();
  },
});
