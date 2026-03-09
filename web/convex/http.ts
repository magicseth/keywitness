import { httpRouter } from "convex/server";
import { registerStaticRoutes } from "@convex-dev/self-hosting";
import { components, internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

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

// POST /api/attestations/verify-biometric - add biometric verification to attestation
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

// POST /api/app-attest/challenge - create a challenge for App Attest attestation
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

// OPTIONS for CORS preflight on app-attest/challenge
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

// POST /api/app-attest/verify - verify a one-time App Attest key attestation
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

// OPTIONS for CORS preflight on app-attest/verify
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

// Serve static files last
registerStaticRoutes(http, components.selfHosting);

export default http;
