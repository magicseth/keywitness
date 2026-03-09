/**
 * Trust management and revocation system.
 *
 * Admin operations are mutations callable via `npx convex run trust:<fn>`.
 * Public queries are used by the iOS app and web verifier.
 *
 * Implements:
 * - App version trust / forced upgrade (Signal pattern)
 * - Provider trust registry (EBSI-inspired)
 * - Key/credential revocation
 * - BitstringStatusList (W3C Recommendation) for credential-level revocation
 */

import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";

// ── App Version Trust ────────────────────────────────────────────────────────

/** Mark an app version as trusted or revoked. */
export const setAppVersionTrust = mutation({
  args: {
    version: v.string(),
    trusted: v.boolean(),
    bundleId: v.optional(v.string()),
    revocationReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appVersions")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        trusted: args.trusted,
        revokedAt: args.trusted ? undefined : Date.now(),
        revocationReason: args.trusted ? undefined : args.revocationReason,
      });
      return { updated: true, version: args.version };
    }

    await ctx.db.insert("appVersions", {
      version: args.version,
      bundleId: args.bundleId,
      trusted: args.trusted,
      revokedAt: args.trusted ? undefined : Date.now(),
      revocationReason: args.trusted ? undefined : args.revocationReason,
      createdAt: Date.now(),
    });
    return { created: true, version: args.version };
  },
});

/** Set the minimum required app version for forced upgrade. */
export const setMinimumAppVersion = mutation({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "minimumAppVersion"))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        value: args.version,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("appConfig", {
        key: "minimumAppVersion",
        value: args.version,
        updatedAt: Date.now(),
      });
    }
    return { minimumVersion: args.version };
  },
});

/** Get the minimum required app version. */
export const getMinimumAppVersion = query({
  args: {},
  handler: async (ctx) => {
    const config = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "minimumAppVersion"))
      .first();
    return { minimumVersion: config?.value ?? null };
  },
});

/** Check if a specific app version is trusted. */
export const isAppVersionTrusted = query({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const record = await ctx.db
      .query("appVersions")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .first();
    // If no record exists, the version is trusted by default (permissive)
    if (!record) return { trusted: true, explicit: false };
    return {
      trusted: record.trusted,
      explicit: true,
      revokedAt: record.revokedAt,
      revocationReason: record.revocationReason,
    };
  },
});

// ── Provider Trust ───────────────────────────────────────────────────────────

/** Add or update a trusted provider. */
export const addProvider = mutation({
  args: {
    providerId: v.string(),
    name: v.string(),
    type: v.optional(v.string()),
    platform: v.optional(v.string()),
    proofTypes: v.array(v.string()),
    signingAlgorithms: v.array(v.string()),
    contextUrl: v.optional(v.string()),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("providerTrust")
      .withIndex("by_providerId", (q) => q.eq("providerId", args.providerId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: args.name,
        type: args.type,
        platform: args.platform,
        proofTypes: args.proofTypes,
        signingAlgorithms: args.signingAlgorithms,
        contextUrl: args.contextUrl,
        expiresAt: args.expiresAt,
        trusted: true,
        revokedAt: undefined,
        revocationReason: undefined,
      });
      return { updated: true, providerId: args.providerId };
    }

    await ctx.db.insert("providerTrust", {
      ...args,
      trusted: true,
      createdAt: Date.now(),
    });
    return { created: true, providerId: args.providerId };
  },
});

/** Revoke trust for a provider. */
export const revokeProvider = mutation({
  args: {
    providerId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("providerTrust")
      .withIndex("by_providerId", (q) => q.eq("providerId", args.providerId))
      .first();

    if (!existing) throw new Error(`Provider not found: ${args.providerId}`);

    await ctx.db.patch(existing._id, {
      trusted: false,
      revokedAt: Date.now(),
      revocationReason: args.reason,
    });

    // Also add to revocations table for the audit trail
    await ctx.db.insert("revocations", {
      type: "provider",
      identifier: args.providerId,
      reason: args.reason,
      revokedAt: Date.now(),
    });

    return { revoked: true, providerId: args.providerId };
  },
});

/** Get all trusted providers (non-expired, non-revoked). */
export const getProviders = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("providerTrust").collect();
    const now = Date.now();
    return all.filter((p) => {
      if (!p.trusted) return false;
      if (p.expiresAt && p.expiresAt < now) return false;
      return true;
    });
  },
});

// ── Key / Credential Revocation ──────────────────────────────────────────────

/** Revoke an Ed25519 public key or App Attest credential. */
export const revokeKey = mutation({
  args: {
    type: v.union(v.literal("ed25519"), v.literal("appAttest")),
    identifier: v.string(),
    reason: v.string(),
    revokedBy: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Check if already revoked
    const existing = await ctx.db
      .query("revocations")
      .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
      .first();

    if (existing) {
      return { alreadyRevoked: true, identifier: args.identifier };
    }

    await ctx.db.insert("revocations", {
      type: args.type,
      identifier: args.identifier,
      reason: args.reason,
      revokedBy: args.revokedBy,
      revokedAt: Date.now(),
    });

    return { revoked: true, identifier: args.identifier };
  },
});

/** Unrevoke a key (escape hatch for accidental revocations). */
export const unrevokeKey = mutation({
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("revocations")
      .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
      .first();

    if (!existing) return { notFound: true };

    await ctx.db.delete(existing._id);
    return { unrevoked: true, identifier: args.identifier };
  },
});

/** Check if a key/credential is revoked. */
export const isRevoked = query({
  args: { identifier: v.string() },
  handler: async (ctx, args) => {
    const revocation = await ctx.db
      .query("revocations")
      .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
      .first();

    if (!revocation) return { revoked: false };
    return {
      revoked: true,
      type: revocation.type,
      reason: revocation.reason,
      revokedAt: revocation.revokedAt,
      revokedBy: revocation.revokedBy,
    };
  },
});

/** List all revocations, optionally filtered by type. */
export const listRevocations = query({
  args: { type: v.optional(v.union(v.literal("ed25519"), v.literal("appAttest"), v.literal("provider"))) },
  handler: async (ctx, args) => {
    if (args.type) {
      return await ctx.db
        .query("revocations")
        .withIndex("by_type", (q) => q.eq("type", args.type!))
        .collect();
    }
    return await ctx.db.query("revocations").collect();
  },
});

// ── Composite Trust Status Query ─────────────────────────────────────────────

/** Single query returning full trust status for a verification request. */
export const getTrustStatus = query({
  args: {
    publicKey: v.optional(v.string()),
    appAttestKeyId: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    providerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const result: {
      keyRevoked: boolean;
      keyRevocationReason?: string;
      credentialRevoked: boolean;
      credentialRevocationReason?: string;
      appVersionTrusted?: boolean;
      appVersionRevocationReason?: string;
      providerTrusted?: boolean;
      providerRevocationReason?: string;
      minimumVersion?: string;
    } = {
      keyRevoked: false,
      credentialRevoked: false,
    };

    // Check Ed25519 key revocation
    if (args.publicKey) {
      const keyRevocation = await ctx.db
        .query("revocations")
        .withIndex("by_identifier", (q) => q.eq("identifier", args.publicKey!))
        .first();
      if (keyRevocation) {
        result.keyRevoked = true;
        result.keyRevocationReason = keyRevocation.reason;
      }
    }

    // Check App Attest credential revocation
    if (args.appAttestKeyId) {
      const credRevocation = await ctx.db
        .query("revocations")
        .withIndex("by_identifier", (q) => q.eq("identifier", args.appAttestKeyId!))
        .first();
      if (credRevocation) {
        result.credentialRevoked = true;
        result.credentialRevocationReason = credRevocation.reason;
      }
    }

    // Check app version trust
    if (args.appVersion) {
      const versionRecord = await ctx.db
        .query("appVersions")
        .withIndex("by_version", (q) => q.eq("version", args.appVersion!))
        .first();
      // Permissive: trusted unless explicitly revoked
      result.appVersionTrusted = versionRecord ? versionRecord.trusted : true;
      if (versionRecord && !versionRecord.trusted) {
        result.appVersionRevocationReason = versionRecord.revocationReason;
      }
    }

    // Check provider trust
    if (args.providerId) {
      const provider = await ctx.db
        .query("providerTrust")
        .withIndex("by_providerId", (q) => q.eq("providerId", args.providerId!))
        .first();
      if (provider) {
        const now = Date.now();
        result.providerTrusted = provider.trusted && (!provider.expiresAt || provider.expiresAt > now);
        if (!result.providerTrusted) {
          result.providerRevocationReason = provider.revocationReason;
        }
      }
      // Unknown provider: don't mark as untrusted (permissive for new providers)
    }

    // Always include minimum version
    const minVersion = await ctx.db
      .query("appConfig")
      .withIndex("by_key", (q) => q.eq("key", "minimumAppVersion"))
      .first();
    result.minimumVersion = minVersion?.value;

    return result;
  },
});

// ── BitstringStatusList ──────────────────────────────────────────────────────

// Minimum bitstring size: 16KB = 131,072 bits (per W3C spec)
const MIN_BITSTRING_SIZE = 131072;

/**
 * Create a new status list. Call once to initialize.
 * The bitstring starts as all-zeros (all credentials valid).
 */
export const createStatusList = mutation({
  args: {
    listId: v.string(),
    statusPurpose: v.string(), // "revocation" or "suspension"
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", args.listId))
      .first();

    if (existing) throw new Error(`Status list ${args.listId} already exists`);

    // Create a zero-filled bitstring, GZIP compress, base64url encode
    // For Convex (no native zlib), we store the raw base64url bitstring
    // and compress on read for the VC response.
    // A 16KB zero buffer = 16384 bytes = 131072 bits
    const zeroBytes = new Uint8Array(MIN_BITSTRING_SIZE / 8);
    const encoded = uint8ToBase64url(zeroBytes);

    await ctx.db.insert("statusLists", {
      listId: args.listId,
      statusPurpose: args.statusPurpose,
      encodedList: encoded,
      nextIndex: 0,
      updatedAt: Date.now(),
    });

    return { created: true, listId: args.listId, capacity: MIN_BITSTRING_SIZE };
  },
});

/**
 * Allocate a status index for a new credential.
 * Returns the index to embed in the credential's credentialStatus.
 */
export const allocateStatusIndex = internalMutation({
  args: { listId: v.string() },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", args.listId))
      .first();

    if (!list) throw new Error(`Status list ${args.listId} not found`);
    if (list.nextIndex >= MIN_BITSTRING_SIZE) {
      throw new Error(`Status list ${args.listId} is full`);
    }

    const index = list.nextIndex;
    await ctx.db.patch(list._id, { nextIndex: index + 1 });
    return { index };
  },
});

/**
 * Set a bit in the status list (revoke or suspend a credential).
 * bit=1 means revoked/suspended, bit=0 means valid.
 */
export const setStatusBit = mutation({
  args: {
    listId: v.string(),
    index: v.number(),
    value: v.boolean(), // true = revoked, false = valid
  },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", args.listId))
      .first();

    if (!list) throw new Error(`Status list ${args.listId} not found`);

    const bytes = base64urlToUint8(list.encodedList);
    const byteIndex = Math.floor(args.index / 8);
    const bitIndex = 7 - (args.index % 8); // MSB first

    if (byteIndex >= bytes.length) {
      throw new Error(`Index ${args.index} out of range`);
    }

    if (args.value) {
      bytes[byteIndex] |= (1 << bitIndex);  // set bit
    } else {
      bytes[byteIndex] &= ~(1 << bitIndex); // clear bit
    }

    await ctx.db.patch(list._id, {
      encodedList: uint8ToBase64url(bytes),
      updatedAt: Date.now(),
    });

    return { listId: args.listId, index: args.index, revoked: args.value };
  },
});

/**
 * Check a single bit in the status list.
 */
export const checkStatusBit = query({
  args: {
    listId: v.string(),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const list = await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", args.listId))
      .first();

    if (!list) return { error: "Status list not found" };

    const bytes = base64urlToUint8(list.encodedList);
    const byteIndex = Math.floor(args.index / 8);
    const bitIndex = 7 - (args.index % 8);

    if (byteIndex >= bytes.length) {
      return { error: "Index out of range" };
    }

    const revoked = (bytes[byteIndex] & (1 << bitIndex)) !== 0;
    return { revoked };
  },
});

/** Get the raw status list for serving as a BitstringStatusListCredential. */
export const getStatusList = query({
  args: { listId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", args.listId))
      .first();
  },
});

// ── Revoke a credential by shortId ───────────────────────────────────────────

/** Revoke a specific attestation by its shortId. Sets its bit in the status list. */
export const revokeAttestation = mutation({
  args: {
    shortId: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const attestation = await ctx.db
      .query("attestations")
      .withIndex("by_shortId", (q) => q.eq("shortId", args.shortId))
      .first();

    if (!attestation) throw new Error("Attestation not found");

    if (attestation.statusIndex === undefined) {
      return { error: "Attestation has no status index (pre-revocation era)" };
    }

    // Set the bit in status list "1" (the default list)
    const list = await ctx.db
      .query("statusLists")
      .withIndex("by_listId", (q) => q.eq("listId", "1"))
      .first();

    if (!list) throw new Error("Status list not initialized. Run trust:createStatusList first.");

    const bytes = base64urlToUint8(list.encodedList);
    const byteIndex = Math.floor(attestation.statusIndex / 8);
    const bitIndex = 7 - (attestation.statusIndex % 8);
    bytes[byteIndex] |= (1 << bitIndex);

    await ctx.db.patch(list._id, {
      encodedList: uint8ToBase64url(bytes),
      updatedAt: Date.now(),
    });

    return { revoked: true, shortId: args.shortId, statusIndex: attestation.statusIndex };
  },
});

// ── Base64url helpers ────────────────────────────────────────────────────────

function uint8ToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToUint8(input: string): Uint8Array {
  let base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4 !== 0) base64 += "=";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
