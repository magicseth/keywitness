import { mutation, internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import nacl from "tweetnacl";

/** Generate a cryptographically random short ID. */
function generateShortId(length = 10): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/** SHA-256 hex hash for content dedup. */
async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(data)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Max attestation size: 256KB. */
const MAX_ATTESTATION_SIZE = 256 * 1024;

export const upload = mutation({
  args: {
    attestation: v.string(),
    deviceVerified: v.optional(v.boolean()),
    username: v.optional(v.string()),
    usernameSeq: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Size limit
    if (args.attestation.length > MAX_ATTESTATION_SIZE) {
      throw new Error("Attestation too large (max 256KB)");
    }

    // Content-hash dedup — reject duplicate attestations
    const attestationHash = await sha256Hex(args.attestation);
    const existing = await ctx.db
      .query("attestations")
      .withIndex("by_attestationHash", (q) => q.eq("attestationHash", attestationHash))
      .first();
    if (existing) {
      // Return the existing attestation instead of creating a duplicate
      return {
        id: existing.shortId,
        url: `/v/${existing.shortId}`,
        statusIndex: existing.statusIndex,
        deduplicated: true,
      };
    }

    // Generate shortId with collision check (retry up to 3 times)
    let shortId = generateShortId();
    for (let attempt = 0; attempt < 3; attempt++) {
      const collision = await ctx.db
        .query("attestations")
        .withIndex("by_shortId", (q) => q.eq("shortId", shortId))
        .first();
      if (!collision) break;
      shortId = generateShortId();
    }

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
      attestationHash,
      createdAt: Date.now(),
      deviceVerified: args.deviceVerified || undefined,
      statusIndex,
      username: args.username,
      usernameSeq: args.usernameSeq,
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
      username: doc.username,
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

    // Verify the Ed25519 signature over "keywitness:biometric:{shortId}"
    const challenge = `keywitness:biometric:${args.shortId}`;
    const challengeBytes = new TextEncoder().encode(challenge);
    const sigBytes = base64urlDecodeAttest(args.signature);
    const pubKeyBytes = base64urlDecodeAttest(args.publicKey);

    if (sigBytes.length !== 64) {
      throw new Error(`Invalid signature length: ${sigBytes.length} (expected 64)`);
    }
    if (pubKeyBytes.length !== 32) {
      throw new Error(`Invalid public key length: ${pubKeyBytes.length} (expected 32)`);
    }

    const valid = nacl.sign.detached.verify(challengeBytes, sigBytes, pubKeyBytes);
    if (!valid) {
      throw new Error("Biometric signature verification failed");
    }

    await ctx.db.patch(doc._id, {
      biometricSignature: args.signature,
      biometricPublicKey: args.publicKey,
      biometricTimestamp: Date.now(),
    });
    return { success: true };
  },
});

/** Internal only — called from HTTP handlers after App Attest verification. */
export const markDeviceVerified = internalMutation({
  args: {
    shortId: v.string(),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("attestations")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();
    if (!doc) throw new Error("Attestation not found");
    await ctx.db.patch(doc._id, { deviceVerified: true });
    return { success: true };
  },
});

// ── Base64url helper ─────────────────────────────────────────────────────────

function base64urlDecodeAttest(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
