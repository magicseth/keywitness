import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/self-hosting";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// ── Attestation API ──────────────────────────────────────────────────────────

// POST /api/attestations - upload an attestation (called by iOS keyboard)
http.route({
  path: "/api/attestations",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();

    // If App Attest assertion is provided, verify it before storing
    let deviceVerified = false;
    if (body.appAttestKeyId && body.appAttestAssertion && body.appAttestClientData) {
      try {
        await ctx.runMutation(internal.appAttest.verifyAssertion, {
          keyId: body.appAttestKeyId,
          assertion: body.appAttestAssertion,
          expectedClientData: body.appAttestClientData,
        });
        deviceVerified = true;
      } catch {
        // Assertion failed — store attestation but mark as unverified
      }
    }

    const result = await ctx.runMutation(api.attestations.upload, {
      attestation: body.attestation,
      deviceVerified: deviceVerified || undefined,
    });
    const origin = new URL(request.url).origin;
    return new Response(JSON.stringify({
      id: result.id,
      url: `${origin}/v/${result.id}`,
    }), {
      status: 201,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// OPTIONS for CORS preflight
http.route({
  path: "/api/attestations",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Key Registration API ─────────────────────────────────────────────────────

// POST /api/keys/register - register a public key
http.route({
  path: "/api/keys/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const result = await ctx.runMutation(api.keys.register, {
      publicKey: body.publicKey,
      name: body.name,
      signature: body.signature,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

// OPTIONS for CORS preflight on keys/register
http.route({
  path: "/api/keys/register",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── Biometric Verification API ───────────────────────────────────────────────

// POST /api/attestations/verify-biometric
http.route({
  path: "/api/attestations/verify-biometric",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    try {
      const result = await ctx.runMutation(api.attestations.addBiometricVerification, {
        shortId: body.shortId,
        signature: body.signature,
        publicKey: body.publicKey,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }),
});

// OPTIONS for CORS preflight on verify-biometric
http.route({
  path: "/api/attestations/verify-biometric",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── App Attest API ───────────────────────────────────────────────────────────

// POST /api/app-attest/challenge
http.route({
  path: "/api/app-attest/challenge",
  method: "POST",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runMutation(api.appAttest.createChallenge, {});
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

http.route({
  path: "/api/app-attest/challenge",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// POST /api/app-attest/verify
http.route({
  path: "/api/app-attest/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    try {
      const result = await ctx.runMutation(api.appAttest.verifyKeyAttestation, {
        keyId: body.keyId,
        attestation: body.attestation,
        challenge: body.challenge,
        publicKey: body.publicKey,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  }),
});

http.route({
  path: "/api/app-attest/verify",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── JSON-LD Context (Phase 2.3) ──────────────────────────────────────────────

// GET /ns/v1 - KeyWitness JSON-LD context document
http.route({
  path: "/ns/v1",
  method: "GET",
  handler: httpAction(async () => {
    const context = {
      "@context": {
        "KeyWitnessAttestation": "https://keywitness.io/ns/v1#KeyWitnessAttestation",
        "HumanTypedContent": "https://keywitness.io/ns/v1#HumanTypedContent",
        "cleartextHash": "https://keywitness.io/ns/v1#cleartextHash",
        "encryptedCleartext": "https://keywitness.io/ns/v1#encryptedCleartext",
        "deviceId": "https://keywitness.io/ns/v1#deviceId",
        "keystrokeBiometricsHash": "https://keywitness.io/ns/v1#keystrokeBiometricsHash",
        "faceIdVerified": "https://keywitness.io/ns/v1#faceIdVerified",
        "AppleAppAttestProof": "https://keywitness.io/ns/v1#AppleAppAttestProof",
        "keystrokeAttestation": "https://keywitness.io/ns/v1#keystrokeAttestation",
        "biometricVerification": "https://keywitness.io/ns/v1#biometricVerification",
        "deviceAttestation": "https://keywitness.io/ns/v1#deviceAttestation",
        "proofType": "https://keywitness.io/ns/v1#proofType",
        "keyId": "https://keywitness.io/ns/v1#keyId",
        "assertionData": "https://keywitness.io/ns/v1#assertionData",
        "clientData": "https://keywitness.io/ns/v1#clientData",
        "serverVerified": "https://keywitness.io/ns/v1#serverVerified",
      },
    };
    return new Response(JSON.stringify(context, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/ld+json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }),
});

// ── Provider Registry (Phase 4.1) ────────────────────────────────────────────

// GET /.well-known/keywitness-providers.json
http.route({
  path: "/.well-known/keywitness-providers.json",
  method: "GET",
  handler: httpAction(async () => {
    const providers = {
      version: "1.0",
      providers: [
        {
          id: "https://keywitness.io",
          name: "KeyWitness iOS Keyboard",
          type: "software-keyboard",
          platform: "iOS",
          capabilities: ["keystroke-biometrics", "face-id", "app-attest", "aes-gcm-encryption"],
          signingAlgorithm: "Ed25519",
          didMethod: "did:key",
          proofTypes: ["keystrokeAttestation", "biometricVerification", "deviceAttestation"],
          supportedVersions: ["v1", "v2", "v3"],
          verificationEndpoint: "https://keywitness.io/v/{id}",
          contextUrl: "https://keywitness.io/ns/v1",
        },
        {
          id: "https://typeproof.tech",
          name: "TypeProof Hardware Keyboard",
          type: "hardware-keyboard",
          platform: "cross-platform",
          capabilities: ["keystroke-biometrics", "fingerprint", "secure-element", "capacitive-touch"],
          signingAlgorithm: "Ed25519",
          didMethod: "did:key",
          proofTypes: ["keystrokeAttestation", "fingerprintVerification", "hardwareAttestation"],
          supportedVersions: ["v3"],
          contextUrl: "https://typeproof.tech/ns/v1",
        },
      ],
    };
    return new Response(JSON.stringify(providers, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }),
});

// ── Nostr NIP-05 Discovery (Phase 5.1) ──────────────────────────────────────

// GET /.well-known/nostr.json - NIP-05 key discovery
http.route({
  path: "/.well-known/nostr.json",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const name = url.searchParams.get("name");

    if (!name) {
      return new Response(JSON.stringify({ names: {}, keywitness: {} }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // Look up registered keys by name
    const allKeys = await ctx.runQuery(api.keys.list, {});
    const matchingKey = allKeys.find(
      (k) => k.name.toLowerCase() === name.toLowerCase(),
    );

    if (!matchingKey) {
      return new Response(JSON.stringify({ names: {}, keywitness: {} }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // NIP-05 response with KeyWitness extension
    const response = {
      names: {
        [name]: matchingKey.publicKey, // NIP-05 expects hex pubkey but we use base64url
      },
      keywitness: {
        [name]: {
          ed25519: matchingKey.publicKey,
          registeredAt: new Date(matchingKey.registeredAt).toISOString(),
        },
      },
    };

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  }),
});

// ── Bluesky AT Protocol Labeler (Phase 5.2) ─────────────────────────────────

// POST /api/labeler/verify - verify an attestation URL and return label data
http.route({
  path: "/api/labeler/verify",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    const shortId = body.shortId as string;

    if (!shortId) {
      return new Response(JSON.stringify({ error: "Missing shortId" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const doc = await ctx.runQuery(api.attestations.getByShortId, { shortId });
    if (!doc) {
      return new Response(JSON.stringify({ error: "Attestation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Return label-ready data for AT Protocol labeler integration
    const labels: string[] = ["keywitness-verified"];
    if (doc.deviceVerified) labels.push("device-verified");
    if (doc.biometricSignature) labels.push("biometric-verified");

    return new Response(JSON.stringify({
      shortId,
      labels,
      attestedAt: new Date(doc.createdAt).toISOString(),
      deviceVerified: !!doc.deviceVerified,
      biometricVerified: !!doc.biometricSignature,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }),
});

http.route({
  path: "/api/labeler/verify",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// ── C2PA Assertion Format (Phase 5.3) ────────────────────────────────────────

// GET /api/c2pa/:shortId - return attestation as C2PA-compatible assertion
http.route({
  path: "/api/c2pa",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("id");

    if (!shortId) {
      return new Response(JSON.stringify({ error: "Missing id parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const doc = await ctx.runQuery(api.attestations.getByShortId, { shortId });
    if (!doc) {
      return new Response(JSON.stringify({ error: "Attestation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // C2PA assertion format
    const assertion = {
      label: "io.keywitness.attestation",
      data: {
        url: `https://keywitness.io/v/${shortId}`,
        attestedAt: new Date(doc.createdAt).toISOString(),
        deviceVerified: !!doc.deviceVerified,
        biometricVerified: !!doc.biometricSignature,
        attestation: doc.attestation,
      },
    };

    return new Response(JSON.stringify(assertion, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }),
});

// ── EAT Token (Phase 5.4) ────────────────────────────────────────────────────

// GET /api/eat/:shortId - return attestation as Entity Attestation Token claims
http.route({
  path: "/api/eat",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("id");

    if (!shortId) {
      return new Response(JSON.stringify({ error: "Missing id parameter" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const doc = await ctx.runQuery(api.attestations.getByShortId, { shortId });
    if (!doc) {
      return new Response(JSON.stringify({ error: "Attestation not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // EAT (RFC 9711) compatible claims
    const eatClaims = {
      "eat_profile": "tag:keywitness.io,2026:eat-profile:v1",
      "iss": "https://keywitness.io",
      "sub": shortId,
      "iat": Math.floor(doc.createdAt / 1000),
      "keywitness:attestation": doc.attestation,
      "keywitness:device-verified": !!doc.deviceVerified,
      "keywitness:biometric-verified": !!doc.biometricSignature,
      "keywitness:verification-url": `https://keywitness.io/v/${shortId}`,
    };

    return new Response(JSON.stringify(eatClaims, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/eat+json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    });
  }),
});

// ── Serve static files last ──────────────────────────────────────────────────

registerStaticRoutes(http, components.selfHosting);

export default http;
