import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import nacl from "tweetnacl";

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_-]{2,29}$/;

function base64urlDecode(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
}

/** Verify Ed25519 proof-of-possession: signature over message with publicKey. */
function verifyProofOfPossession(publicKey: string, signature: string, message: string): void {
  const pubKeyBytes = base64urlDecode(publicKey);
  const sigBytes = base64urlDecode(signature);
  if (pubKeyBytes.length !== 32) throw new Error("Invalid public key length");
  if (sigBytes.length !== 64) throw new Error("Invalid signature length");
  const messageBytes = new TextEncoder().encode(message);
  const valid = nacl.sign.detached.verify(messageBytes, sigBytes, pubKeyBytes);
  if (!valid) throw new Error("Proof-of-possession failed — cannot prove ownership of public key");
}

/** SHA-256 hash a string, return hex. */
async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Normalize email for consistent hashing: trim + lowercase. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Claim a username, associating it with a public key and recovery email hash.
 *  Requires Ed25519 proof-of-possession: signature over "keywitness:claim:<username>". */
export const claim = mutation({
  args: {
    username: v.string(),
    publicKey: v.string(),
    email: v.string(),
    signature: v.string(),  // Ed25519 signature proving key ownership
  },
  handler: async (ctx, args) => {
    const username = args.username.toLowerCase();

    if (!USERNAME_RE.test(username)) {
      throw new Error(
        "Username must be 3-30 characters, start with a letter, and contain only letters, numbers, hyphens, and underscores."
      );
    }

    // Verify the caller owns the private key for this public key
    verifyProofOfPossession(args.publicKey, args.signature, `keywitness:claim:${username}`);

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

    const emailHash = await sha256Hex(normalizeEmail(args.email));

    await ctx.db.insert("usernames", {
      username,
      emailHash,
      publicKeys: [args.publicKey],
      nextSeq: 1,
      createdAt: Date.now(),
    });

    return { username, alreadyClaimed: false };
  },
});

/** Add a new public key to an existing username (key rotation).
 *  Requires Ed25519 proof-of-possession: signature over
 *  "keywitness:addKey:<username>:<newPublicKey>" signed by existingPublicKey. */
export const addKey = mutation({
  args: {
    username: v.string(),
    existingPublicKey: v.string(),
    newPublicKey: v.string(),
    signature: v.string(),  // Ed25519 signature proving existing key ownership
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

    // Verify the caller owns the existing private key
    verifyProofOfPossession(
      args.existingPublicKey,
      args.signature,
      `keywitness:addKey:${username}:${args.newPublicKey}`,
    );

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
