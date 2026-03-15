import { action, mutation, query, internalMutation } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { v } from "convex/values";
import nacl from "tweetnacl";
import { Resend } from "@convex-dev/resend";

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

/** Debug: look up a username record by name. */
export const debugGetByUsername = query({
  args: { username: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", args.username.toLowerCase()))
      .first();
    if (!doc) return null;
    return { username: doc.username, emailHash: doc.emailHash, publicKeys: doc.publicKeys, createdAt: doc.createdAt };
  },
});

/** Admin: update email hash for a username. */
export const adminUpdateEmail = mutation({
  args: { username: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", args.username.toLowerCase()))
      .first();
    if (!doc) throw new Error("Username not found");
    const emailHash = await sha256Hex(normalizeEmail(args.email));
    await ctx.db.patch(doc._id, { emailHash });
    return { success: true, emailHash };
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


// ── Email-verified recovery (two-step) ──────────────────────────────────────

const resend = new Resend(components.resend);

/** Step 1: Request recovery — verify email matches, send a 6-digit code. */
export const requestRecovery = action({
  args: {
    username: v.string(),
    newPublicKey: v.string(),
    email: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const username = args.username.toLowerCase();

    // Verify the caller owns the new private key
    verifyProofOfPossession(args.newPublicKey, args.signature, `keywitness:recover:${username}`);

    // Check username exists and email matches
    const result = await ctx.runMutation(internal.usernames.createRecoveryRequest, {
      username,
      newPublicKey: args.newPublicKey,
      email: args.email,
    });

    // Send the code via email
    await resend.sendEmail(ctx, {
      from: "KeyWitness <noreply@keywitness.io>",
      to: args.email,
      subject: `Your KeyWitness recovery code: ${result.code}`,
      html: `
        <div style="font-family: -apple-system, sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
          <h2 style="color: #111; margin-bottom: 8px;">KeyWitness Recovery</h2>
          <p style="color: #666;">Use this code to recover your username <strong>${username}</strong>:</p>
          <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; text-align: center; margin: 24px 0;">
            <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #111;">${result.code}</span>
          </div>
          <p style="color: #999; font-size: 13px;">This code expires in 10 minutes. If you didn't request this, ignore this email.</p>
        </div>
      `,
    });

    return { success: true };
  },
});

/** Internal: create recovery request after validating email hash. */
export const createRecoveryRequest = internalMutation({
  args: {
    username: v.string(),
    newPublicKey: v.string(),
    email: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", args.username))
      .first();

    if (!doc) throw new Error("Username not found.");

    // Verify email matches
    const emailHash = await sha256Hex(normalizeEmail(args.email));
    if (emailHash !== doc.emailHash) {
      throw new Error("Email does not match the one used to register this username.");
    }

    // Already authorized?
    if (doc.publicKeys.includes(args.newPublicKey)) {
      throw new Error("This device is already authorized.");
    }

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await sha256Hex(code);

    // Delete any existing recovery requests for this username+key
    const existing = await ctx.db
      .query("recoveryRequests")
      .withIndex("by_username_key", (q) =>
        q.eq("username", args.username).eq("newPublicKey", args.newPublicKey)
      )
      .collect();
    for (const r of existing) {
      await ctx.db.delete(r._id);
    }

    // Store the request (code hashed, expires in 10 minutes)
    await ctx.db.insert("recoveryRequests", {
      username: args.username,
      newPublicKey: args.newPublicKey,
      codeHash,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
      used: false,
    });

    return { code };
  },
});

/** Step 2: Confirm recovery with the emailed code. */
export const confirmRecovery = mutation({
  args: {
    username: v.string(),
    newPublicKey: v.string(),
    code: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, args) => {
    const username = args.username.toLowerCase();

    // Verify the caller still owns the new private key
    verifyProofOfPossession(args.newPublicKey, args.signature, `keywitness:recover:${username}`);

    // Find the recovery request
    const requests = await ctx.db
      .query("recoveryRequests")
      .withIndex("by_username_key", (q) =>
        q.eq("username", username).eq("newPublicKey", args.newPublicKey)
      )
      .collect();

    const request = requests.find((r) => !r.used && r.expiresAt > Date.now());
    if (!request) {
      throw new Error("No pending recovery request. Please request a new code.");
    }

    // Rate limit: max 5 attempts
    if (request.attempts >= 5) {
      await ctx.db.patch(request._id, { used: true });
      throw new Error("Too many attempts. Please request a new code.");
    }

    // Verify code
    const codeHash = await sha256Hex(args.code);
    if (codeHash !== request.codeHash) {
      await ctx.db.patch(request._id, { attempts: request.attempts + 1 });
      throw new Error("Invalid code.");
    }

    // Mark request as used
    await ctx.db.patch(request._id, { used: true });

    // Add new key to username
    const doc = await ctx.db
      .query("usernames")
      .withIndex("by_username", (q) => q.eq("username", username))
      .first();

    if (!doc) throw new Error("Username not found.");

    if (!doc.publicKeys.includes(args.newPublicKey)) {
      await ctx.db.patch(doc._id, {
        publicKeys: [...doc.publicKeys, args.newPublicKey],
      });
    }

    return { success: true };
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
