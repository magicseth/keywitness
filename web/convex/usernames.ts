import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{2,29}$/;

/** Claim a username, associating it with a public key and recovery email. */
export const claim = mutation({
  args: {
    username: v.string(),
    publicKey: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const username = args.username.toLowerCase();

    if (!USERNAME_RE.test(username)) {
      throw new Error(
        "Username must be 3-30 characters, start with a letter, and contain only letters, numbers, hyphens, and underscores."
      );
    }

    const existing = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();

    if (existing) {
      // If the public key is already authorized, this is a no-op
      if (existing.publicKeys.includes(args.publicKey)) {
        return { username, alreadyClaimed: true };
      }
      throw new Error("Username is already taken.");
    }

    await ctx.db.insert("usernames", {
      username,
      email: args.email,
      publicKeys: [args.publicKey],
      nextSeq: 1,
      createdAt: Date.now(),
    });

    return { username, alreadyClaimed: false };
  },
});

/** Add a new public key to an existing username (key rotation). */
export const addKey = mutation({
  args: {
    username: v.string(),
    existingPublicKey: v.string(),
    newPublicKey: v.string(),
  },
  handler: async (ctx, args) => {
    const username = args.username.toLowerCase();
    const doc = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();

    if (!doc) throw new Error("Username not found.");
    if (!doc.publicKeys.includes(args.existingPublicKey)) {
      throw new Error("Not authorized for this username.");
    }
    if (doc.publicKeys.includes(args.newPublicKey)) {
      return { success: true, alreadyAdded: true };
    }

    await ctx.db.patch(doc._id, {
      publicKeys: [...doc.publicKeys, args.newPublicKey],
    });
    return { success: true, alreadyAdded: false };
  },
});

/** Look up a username by public key. */
export const getByPublicKey = query({
  args: { publicKey: v.string() },
  handler: async (ctx, args) => {
    // Scan usernames for this public key (small table, fine for now)
    const all = await ctx.db.query("usernames").collect();
    const match = all.find((u) => u.publicKeys.includes(args.publicKey));
    if (!match) return null;
    return { username: match.username };
  },
});

/** Resolve username + seq to a shortId. */
export const resolve = query({
  args: {
    username: v.string(),
    seq: v.number(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("attestations")
      .withIndex("by_username_seq", (q) =>
        q.eq("username", args.username.toLowerCase()).eq("usernameSeq", args.seq)
      )
      .first();
    if (!doc) return null;
    return { shortId: doc.shortId };
  },
});

/** Allocate the next sequence number for a username. */
export const allocateSeq = mutation({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const username = args.username.toLowerCase();
    const doc = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();
    if (!doc) return null;

    const seq = doc.nextSeq;
    await ctx.db.patch(doc._id, { nextSeq: seq + 1 });
    return { seq };
  },
});
