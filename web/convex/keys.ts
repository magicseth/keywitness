import { mutation, query, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import nacl from "tweetnacl";

// ── Base64url helpers ────────────────────────────────────────────────────────

function base64urlDecode(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) {
    base64 += "=";
  }
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// ── Mutations ────────────────────────────────────────────────────────────────

export const register = mutation({
  args: {
    publicKey: v.string(),
    name: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    // Verify the caller owns the private key by checking their signature
    // over the challenge "keywitness:register:<publicKey>:<name>"
    const challenge = `keywitness:register:${args.publicKey}:${args.name}`;
    const challengeBytes = new TextEncoder().encode(challenge);

    let publicKeyBytes: Uint8Array;
    let signatureBytes: Uint8Array;
    try {
      publicKeyBytes = base64urlDecode(args.publicKey);
      signatureBytes = base64urlDecode(args.signature);
    } catch {
      throw new Error("Invalid base64url encoding in publicKey or signature");
    }

    if (publicKeyBytes.length !== 32) {
      throw new Error("Invalid public key length");
    }
    if (signatureBytes.length !== 64) {
      throw new Error("Invalid signature length");
    }

    const valid = nacl.sign.detached.verify(
      challengeBytes,
      signatureBytes,
      publicKeyBytes,
    );
    if (!valid) {
      throw new Error("Signature verification failed — you must prove ownership of the private key to register");
    }

    // SECURITY: enforce name uniqueness. NIP-05 resolution returned the first
    // arbitrary match, so without this any key could squat any name and make
    // discovery non-deterministic / attacker-controllable.
    const nameLower = args.name.toLowerCase();
    const allKeys = await ctx.db.query("keys").collect();
    const nameOwner = allKeys.find((k) => k.name.toLowerCase() === nameLower);
    if (nameOwner && nameOwner.publicKey !== args.publicKey) {
      throw new Error("Name is already registered to a different key.");
    }

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

/** Public NIP-05 resolution: deterministically resolve a name to one key
 * (earliest registration wins if legacy duplicates exist). */
export const getByName = query({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const nameLower = args.name.toLowerCase();
    const all = await ctx.db.query("keys").collect();
    const matches = all
      .filter((k) => k.name.toLowerCase() === nameLower)
      .sort((a, b) => a.registeredAt - b.registeredAt);
    return matches[0] ?? null;
  },
});

// Internal-only: dumps the full NIP-05 key registry. Not for public exposure.
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("keys").collect();
  },
});
