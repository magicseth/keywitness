import { httpRouter } from "convex/server";
// registerStaticRoutes replaced by custom catch-all handler (see bottom of file)
// to support per-attestation OG tags for bots on vanity URLs.
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

    // Verify the attestation signature FIRST, before trusting any metadata.
    // This prevents a forged payload from claiming another signer's identity.
    const verificationResult = await verifyAttestationServerSide(body.attestation);
    if (!verificationResult.valid) {
      return new Response(JSON.stringify({ error: "Attestation signature verification failed", details: verificationResult.error }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Now that the signature is verified, extract signer metadata safely
    let deviceVerified = false;
    const signerKey = verificationResult.publicKey;
    if (signerKey) {
      deviceVerified = await ctx.runQuery(internal.appAttest.hasDeviceCredential, {
        publicKey: signerKey,
      });
    }

    // Look up username for the verified signer's public key
    let username: string | undefined;
    let usernameSeq: number | undefined;
    if (signerKey) {
      const usernameDoc = await ctx.runQuery(api.usernames.getByPublicKey, { publicKey: signerKey });
      if (usernameDoc) {
        username = usernameDoc.username;
        const seqResult = await ctx.runMutation(api.usernames.allocateSeq, { username });
        if (seqResult) {
          usernameSeq = seqResult.seq;
        }
      }
    }

    const result = await ctx.runMutation(api.attestations.upload, {
      attestation: body.attestation,
      deviceVerified: deviceVerified || undefined,
      username,
      usernameSeq,
    });

    // Include minimum version in response for forced upgrade
    const minVersion = await ctx.runQuery(api.trust.getMinimumAppVersion, {});

    // Check trust warnings
    const warnings: string[] = [];
    if (body.appVersion) {
      const versionTrust = await ctx.runQuery(api.trust.isAppVersionTrusted, { version: body.appVersion });
      if (!versionTrust.trusted) warnings.push("app_version_revoked");
    }

    // Build URL — use typed.by vanity URL if username is available
    const origin = new URL(request.url).origin;
    const url = username && usernameSeq
      ? `https://typed.by/${username}/${usernameSeq}`
      : `${origin}/v/${result.id}`;

    return new Response(JSON.stringify({
      id: result.id,
      url,
      statusIndex: result.statusIndex,
      minimumVersion: minVersion.minimumVersion,
      warnings: warnings.length > 0 ? warnings : undefined,
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

// ── Username API ─────────────────────────────────────────────────────────────

// POST /api/usernames/claim - claim a username
http.route({
  path: "/api/usernames/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.json();
    if (!body.username || !body.publicKey || !body.email || !body.signature) {
      return new Response(JSON.stringify({ error: "Missing username, publicKey, email, or signature" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    try {
      const result = await ctx.runMutation(api.usernames.claim, {
        username: body.username,
        publicKey: body.publicKey,
        email: body.email,
        signature: body.signature,
      });
      return new Response(JSON.stringify(result), {
        status: 201,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    } catch (e) {
      return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
        status: 409,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  }),
});

http.route({
  path: "/api/usernames/claim",
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

// GET /api/resolve/:username/:seq - resolve vanity URL to shortId
http.route({
  path: "/api/resolve",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const username = url.searchParams.get("username");
    const seq = url.searchParams.get("seq");
    if (!username || !seq) {
      return new Response(JSON.stringify({ error: "Missing username or seq" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    const result = await ctx.runQuery(api.usernames.resolve, {
      username,
      seq: parseInt(seq, 10),
    });
    if (!result) {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
      // Identity binding: verify the biometric signer matches the attestation's signer
      const doc = await ctx.runQuery(api.attestations.getByShortId, { shortId: body.shortId });
      if (!doc) {
        return new Response(JSON.stringify({ error: "Attestation not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }
      const attestationSigner = extractSignerPublicKey(doc.attestation);
      if (attestationSigner && body.publicKey && attestationSigner !== body.publicKey) {
        return new Response(JSON.stringify({ error: "Biometric key does not match attestation signer" }), {
          status: 403,
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        });
      }

      const result = await ctx.runMutation(api.attestations.addBiometricVerification, {
        shortId: body.shortId,
        signature: body.signature,
        publicKey: body.publicKey,
      });

      // If App Attest assertion is included (from main app), verify it and mark device as verified
      let deviceVerified = false;
      let appAttestError: string | null = null;
      console.log("Biometric verify — appAttestKeyId:", body.appAttestKeyId ?? "MISSING", "hasAssertion:", !!body.appAttestAssertion, "hasClientData:", !!body.appAttestClientData);
      if (body.appAttestKeyId && body.appAttestAssertion && body.appAttestClientData) {
        try {
          const attestResult = await ctx.runMutation(internal.appAttest.verifyAssertion, {
            keyId: body.appAttestKeyId,
            assertion: body.appAttestAssertion,
            expectedClientData: body.appAttestClientData,
          });

          // Verify the biometric signer matches the App Attest credential's linked key
          if (attestResult.linkedEd25519Key === body.publicKey) {
            deviceVerified = true;
            await ctx.runMutation(internal.attestations.markDeviceVerified, {
              shortId: body.shortId,
            });
          } else {
            appAttestError = "Biometric key does not match App Attest credential's linked key";
            console.error("Biometric signer mismatch:", body.publicKey?.slice(0, 12), "vs linked", attestResult.linkedEd25519Key?.slice(0, 12));
          }
        } catch (e) {
          appAttestError = e instanceof Error ? e.message : String(e);
          console.error("App Attest in biometric verify failed:", appAttestError);
        }
      }

      return new Response(JSON.stringify({ ...result, deviceVerified, appAttestError }), {
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
        publicKeySignature: body.publicKeySignature,
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

// ── Debug: App Attest credentials ────────────────────────────────────────────

http.route({
  path: "/api/app-attest/debug",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const creds = await ctx.runQuery(api.appAttest.listCredentials, {});
    return new Response(JSON.stringify({ credentials: creds }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
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
        "appVersion": "https://keywitness.io/ns/v1#appVersion",
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

    // Cryptographically verify the attestation before returning labels
    const verifyResult = await verifyAttestationServerSide(doc.attestation);
    if (!verifyResult.valid) {
      return new Response(JSON.stringify({
        shortId,
        labels: [],
        error: "Attestation cryptographic verification failed",
        verificationError: verifyResult.error,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Only assign labels after cryptographic verification passes
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

// ── Trust & Revocation API ────────────────────────────────────────────────────

// GET /api/trust/status - composite trust status check
http.route({
  path: "/api/trust/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const result = await ctx.runQuery(api.trust.getTrustStatus, {
      publicKey: url.searchParams.get("publicKey") || undefined,
      appAttestKeyId: url.searchParams.get("appAttestKeyId") || undefined,
      appVersion: url.searchParams.get("appVersion") || undefined,
      providerId: url.searchParams.get("providerId") || undefined,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    });
  }),
});

// GET /api/trust/minimum-version - forced upgrade check
http.route({
  path: "/api/trust/minimum-version",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const result = await ctx.runQuery(api.trust.getMinimumAppVersion, {});
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  }),
});

// GET /api/trust/revocations - list revocations
http.route({
  path: "/api/trust/revocations",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const type = url.searchParams.get("type") as "ed25519" | "appAttest" | "provider" | null;
    const result = await ctx.runQuery(api.trust.listRevocations, {
      type: type || undefined,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    });
  }),
});

// GET /api/trust/providers - list trusted providers (DB-backed)
http.route({
  path: "/api/trust/providers",
  method: "GET",
  handler: httpAction(async (ctx) => {
    const providers = await ctx.runQuery(api.trust.getProviders, {});
    // Shape into the same format as the static JSON
    return new Response(JSON.stringify({
      version: "1.0",
      providers: providers.map((p) => ({
        id: p.providerId,
        name: p.name,
        type: p.type,
        platform: p.platform,
        proofTypes: p.proofTypes,
        signingAlgorithms: p.signingAlgorithms,
        contextUrl: p.contextUrl,
        trusted: p.trusted,
      })),
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  }),
});

// ── BitstringStatusList Credential (W3C) ─────────────────────────────────────

// GET /credentials/status/:listId - serve status list as a VC
http.route({
  path: "/credentials/status",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const listId = url.searchParams.get("id") || "1";

    const list = await ctx.runQuery(api.trust.getStatusList, { listId });
    if (!list) {
      return new Response(JSON.stringify({ error: "Status list not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // Serve as a BitstringStatusListCredential (W3C format)
    const origin = new URL(request.url).origin;
    const statusListCredential = {
      "@context": ["https://www.w3.org/ns/credentials/v2"],
      "id": `${origin}/credentials/status?id=${listId}`,
      "type": ["VerifiableCredential", "BitstringStatusListCredential"],
      "issuer": "https://keywitness.io",
      "validFrom": new Date(list.updatedAt).toISOString(),
      "credentialSubject": {
        "id": `${origin}/credentials/status?id=${listId}#list`,
        "type": "BitstringStatusList",
        "statusPurpose": list.statusPurpose,
        "encodedList": list.encodedList,
      },
    };

    return new Response(JSON.stringify(statusListCredential, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/vc+ld+json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=60",
      },
    });
  }),
});

// ── Verification API (Third-Party Integration) ──────────────────────────────

import { verifyAttestationServerSide, extractSignerPublicKey } from "./lib/verify";

// POST /api/verify - verify a raw attestation block (server-side crypto)
http.route({
  path: "/api/verify",
  method: "POST",
  handler: httpAction(async (_ctx, request) => {
    const body = await request.json();
    const { attestation } = body;
    if (!attestation || typeof attestation !== "string") {
      return new Response(JSON.stringify({ error: "Missing 'attestation' field (PEM block string)" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    const result = await verifyAttestationServerSide(attestation);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  }),
});

http.route({
  path: "/api/verify",
  method: "OPTIONS",
  handler: httpAction(async () => {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }),
});

// GET /api/verify?id=shortId - verify by short ID (fetches from DB + verifies)
http.route({
  path: "/api/verify",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("id");
    if (!shortId) {
      return new Response(JSON.stringify({ error: "Missing 'id' query parameter" }), {
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

    const result = await verifyAttestationServerSide(doc.attestation);
    const origin = new URL(request.url).origin;

    return new Response(JSON.stringify({
      shortId,
      url: `${origin}/v/${shortId}`,
      ...result,
      deviceVerified: !!doc.deviceVerified,
      biometricVerified: !!doc.biometricSignature,
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    });
  }),
});

// ── oEmbed Endpoint ──────────────────────────────────────────────────────────

http.route({
  path: "/api/oembed",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");
    const format = url.searchParams.get("format") || "json";

    if (format !== "json") {
      return new Response(JSON.stringify({ error: "Only JSON format supported" }), {
        status: 501, headers: { "Content-Type": "application/json" },
      });
    }
    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "Missing url parameter" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }

    const match = targetUrl.match(/\/v\/([a-zA-Z0-9]+)/);
    if (!match) {
      return new Response(JSON.stringify({ error: "URL does not match /v/{id}" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }
    const shortId = match[1];

    const doc = await ctx.runQuery(api.attestations.getByShortId, { shortId });
    if (!doc) {
      return new Response(JSON.stringify({ error: "Attestation not found" }), {
        status: 404, headers: { "Content-Type": "application/json" },
      });
    }

    const origin = url.origin;
    const oembed = {
      version: "1.0",
      type: "rich",
      provider_name: "KeyWitness",
      provider_url: origin,
      title: "KeyWitness - Verified Human-Typed Content",
      html: `<iframe src="${origin}/embed/badge?id=${shortId}&style=card&theme=light" width="320" height="180" frameborder="0" sandbox="allow-scripts allow-same-origin allow-popups" style="border-radius:8px;border:1px solid #e5e7eb;"></iframe>`,
      width: 320,
      height: 180,
      cache_age: 86400,
      thumbnail_url: `${origin}/og-card.svg`,
    };

    return new Response(JSON.stringify(oembed), {
      status: 200,
      headers: {
        "Content-Type": "application/json+oembed",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=86400",
      },
    });
  }),
});

// ── Embed Badge ──────────────────────────────────────────────────────────────

// GET /embed/badge?id=shortId&style=inline|card|floating&theme=light|dark|auto
http.route({
  path: "/embed/badge",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const url = new URL(request.url);
    const shortId = url.searchParams.get("id") || "";
    const style = url.searchParams.get("style") || "inline";
    const theme = url.searchParams.get("theme") || "auto";
    const origin = url.origin;

    const html = buildBadgeHTML(shortId, style, theme, origin);
    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "X-Frame-Options": "ALLOWALL",
      },
    });
  }),
});

function buildBadgeHTML(shortId: string, style: string, theme: string, origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --bg: ${theme === "dark" ? "#111" : theme === "light" ? "#fff" : "light-dark(#fff, #111)"};
    --fg: ${theme === "dark" ? "#e5e7eb" : theme === "light" ? "#111" : "light-dark(#111, #e5e7eb)"};
    --fg2: ${theme === "dark" ? "#9ca3af" : theme === "light" ? "#6b7280" : "light-dark(#6b7280, #9ca3af)"};
    --green: #22c55e;
    --red: #ef4444;
    --orange: #f59e0b;
    --border: ${theme === "dark" ? "#374151" : theme === "light" ? "#e5e7eb" : "light-dark(#e5e7eb, #374151)"};
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--fg); overflow: hidden; }
  a { color: inherit; text-decoration: none; }
  a:hover { text-decoration: underline; }

  /* Inline badge */
  .badge-inline {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 4px 10px; border-radius: 14px; font-size: 12px; font-weight: 600;
    border: 1px solid var(--border); background: var(--bg);
    cursor: pointer; white-space: nowrap;
  }
  .badge-inline .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .badge-inline .dot.valid { background: var(--green); }
  .badge-inline .dot.invalid { background: var(--red); }
  .badge-inline .dot.loading { background: var(--orange); animation: pulse 1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }

  /* Card badge */
  .badge-card {
    padding: 16px; border-radius: 8px; border: 1px solid var(--border);
    background: var(--bg); max-width: 320px; font-size: 13px;
  }
  .badge-card .header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .badge-card .header .logo { font-weight: 700; font-size: 14px; }
  .badge-card .header .status {
    font-size: 11px; font-weight: 600; text-transform: uppercase;
    padding: 2px 8px; border-radius: 10px; letter-spacing: 0.5px;
  }
  .badge-card .header .status.valid { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-card .header .status.invalid { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-card .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .badge-card .label { color: var(--fg2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge-card .value { font-size: 12px; font-weight: 500; }
  .badge-card .proofs { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
  .badge-card .proof-pill {
    font-size: 10px; padding: 2px 8px; border-radius: 10px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;
  }
  .badge-card .proof-pill.valid { background: rgba(34,197,94,0.15); color: var(--green); }
  .badge-card .proof-pill.invalid { background: rgba(239,68,68,0.15); color: var(--red); }
  .badge-card .footer { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border); font-size: 10px; color: var(--fg2); }

  /* Floating badge */
  .badge-floating {
    width: 44px; height: 44px; border-radius: 50%; display: flex;
    align-items: center; justify-content: center; cursor: pointer;
    font-weight: 800; font-size: 18px; border: 2px solid;
    transition: transform 0.15s;
  }
  .badge-floating:hover { transform: scale(1.1); }
  .badge-floating.valid { border-color: var(--green); color: var(--green); background: rgba(34,197,94,0.1); }
  .badge-floating.invalid { border-color: var(--red); color: var(--red); background: rgba(239,68,68,0.1); }
  .badge-floating.loading { border-color: var(--orange); color: var(--orange); background: rgba(245,158,11,0.1); }
</style>
</head>
<body>
<div id="root"></div>
<script>
(function() {
  var shortId = ${JSON.stringify(shortId)};
  var style = ${JSON.stringify(style)};
  var origin = ${JSON.stringify(origin)};
  var root = document.getElementById("root");
  var result = null;

  function proofLabel(t) {
    switch(t) {
      case "keystrokeAttestation": return "Keystroke";
      case "voiceAttestation": return "Voice";
      case "photoAttestation": return "Photo";
      case "biometricVerification": return "Face ID";
      case "deviceAttestation": return "Device";
      default: return t;
    }
  }

  function formatTime(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); }
    catch(e) { return iso; }
  }

  function renderInline() {
    if (!result) {
      root.innerHTML = '<a class="badge-inline" href="' + origin + '/v/' + shortId + '" target="_blank"><span class="dot loading"></span>Checking...</a>';
      return;
    }
    var cls = result.valid ? "valid" : "invalid";
    var label = result.valid ? "Verified Human" : "Unverified";
    root.innerHTML = '<a class="badge-inline" href="' + origin + '/v/' + shortId + '" target="_blank"><span class="dot ' + cls + '"></span>' + label + '</a>';
  }

  function renderCard() {
    if (!result) {
      root.innerHTML = '<div class="badge-card"><div class="header"><span class="logo">KeyWitness</span><span class="status" style="background:rgba(245,158,11,0.15);color:#f59e0b;">Checking...</span></div></div>';
      return;
    }
    var cls = result.valid ? "valid" : "invalid";
    var statusLabel = result.valid ? "Verified" : "Unverified";
    var proofHtml = "";
    if (result.proofs && result.proofs.length > 0) {
      proofHtml = '<div class="proofs">';
      for (var i = 0; i < result.proofs.length; i++) {
        var p = result.proofs[i];
        proofHtml += '<span class="proof-pill ' + (p.valid ? "valid" : "invalid") + '">' + proofLabel(p.proofType) + '</span>';
      }
      proofHtml += '</div>';
    }
    var deviceBadge = "";
    if (result.deviceVerified) deviceBadge = ' <span class="proof-pill valid">real device</span>';
    else if (result.appAttestPresent) deviceBadge = ' <span class="proof-pill" style="background:rgba(245,158,11,0.15);color:#f59e0b;">unconfirmed device</span>';

    root.innerHTML = '<div class="badge-card">' +
      '<div class="header"><span class="logo">KeyWitness</span><span class="status ' + cls + '">' + statusLabel + '</span></div>' +
      '<div class="row"><span class="label">When</span><span class="value">' + (result.timestamp ? formatTime(result.timestamp) : "—") + '</span></div>' +
      '<div class="row"><span class="label">Device</span><span class="value">' + (result.deviceId ? result.deviceId.slice(0,8) + "..." : "—") + deviceBadge + '</span></div>' +
      proofHtml +
      '<div class="footer"><a href="' + origin + '/v/' + shortId + '" target="_blank">View full verification on KeyWitness</a></div>' +
    '</div>';
  }

  function renderFloating() {
    var cls = !result ? "loading" : result.valid ? "valid" : "invalid";
    root.innerHTML = '<a class="badge-floating ' + cls + '" href="' + origin + '/v/' + shortId + '" target="_blank" title="KeyWitness ' + (!result ? 'Checking...' : result.valid ? 'Verified' : 'Unverified') + '">K</a>';
  }

  function render() {
    if (style === "card") renderCard();
    else if (style === "floating") renderFloating();
    else renderInline();
  }

  render();

  if (!shortId) return;
  fetch(origin + "/api/verify?id=" + encodeURIComponent(shortId))
    .then(function(r) { return r.json(); })
    .then(function(data) {
      result = data;
      render();
      // Notify parent
      if (window.parent !== window) {
        window.parent.postMessage({ type: "keywitness:verified", shortId: shortId, result: data }, "*");
        // Request resize for card
        if (style === "card") {
          var el = root.firstElementChild;
          if (el) window.parent.postMessage({ type: "keywitness:resize", width: el.offsetWidth + 2, height: el.offsetHeight + 2 }, "*");
        }
      }
    })
    .catch(function() {
      result = { valid: false, error: "Failed to fetch verification" };
      render();
    });
})();
</script>
</body>
</html>`;
}

// ── OpenGraph Bot Detection ──────────────────────────────────────────────────
//
// Bots (iMessage, Slack, Twitter, Discord, Facebook, etc.) get a minimal HTML
// page with per-attestation OG tags. Real browsers get the SPA via index.html.

const OG_BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|Facebot|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|TelegramBot|Applebot|iMessage|Pinterestbot|Embedly|Quora|Outbrain|vkShare|Google-AMPHTML|Bing|DuckDuckBot|Baiduspider|Yandex|Sogou|preview/i;

function isBot(userAgent: string | null): boolean {
  if (!userAgent) return false;
  return OG_BOT_RE.test(userAgent);
}

/** Serve index.html from Convex storage (SPA fallback for real browsers). */
async function serveSPA(ctx: { runQuery: Function; storage: { get: Function } }): Promise<Response> {
  const asset = await ctx.runQuery(components.selfHosting.lib.getByPath, { path: "/index.html" });
  if (!asset?.storageId) {
    return new Response("Not Found", { status: 404 });
  }
  const blob = await ctx.storage.get(asset.storageId);
  if (!blob) {
    return new Response("Storage error", { status: 500 });
  }
  return new Response(blob, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, must-revalidate",
    },
  });
}

function buildOGPage(opts: {
  title: string;
  description: string;
  url: string;
  image?: string;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta property="og:site_name" content="KeyWitness">
<meta property="og:title" content="${esc(opts.title)}">
<meta property="og:description" content="${esc(opts.description)}">
<meta property="og:url" content="${esc(opts.url)}">
<meta property="og:type" content="article">
${opts.image ? `<meta property="og:image" content="${esc(opts.image)}">` : ""}
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(opts.title)}">
<meta name="twitter:description" content="${esc(opts.description)}">
<title>${esc(opts.title)}</title>
</head>
<body>
<p>Redirecting...</p>
<script>window.location.replace("${esc(opts.url)}");</script>
</body>
</html>`;
}


// ── Static files + vanity URL OG catch-all ───────────────────────────────────
//
// We replace registerStaticRoutes with a custom catch-all so we can inject
// per-attestation OG tags for vanity URLs (/{username}/{seq}) when bots request
// them. Static file serving logic mirrors @convex-dev/self-hosting behavior.

function hasFileExtension(path: string): boolean {
  const lastSegment = path.split("/").pop() || "";
  return lastSegment.includes(".") && !lastSegment.startsWith(".");
}

function isHashedAsset(path: string): boolean {
  // Vite hashed assets: /assets/index-abc123.js
  return /\/assets\/.*-[a-f0-9]{8,}\.\w+$/.test(path);
}

http.route({
  pathPrefix: "/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    let path = url.pathname;

    // Normalize root
    if (path === "" || path === "/") {
      path = "/index.html";
    }

    // 1. Try to serve a static file
    const asset: any = await ctx.runQuery(components.selfHosting.lib.getByPath, { path });
    if (asset?.storageId) {
      const etag = `"${asset.storageId}"`;
      const ifNoneMatch = request.headers.get("If-None-Match");
      if (ifNoneMatch === etag) {
        return new Response(null, {
          status: 304,
          headers: {
            ETag: etag,
            "Cache-Control": isHashedAsset(path)
              ? "public, max-age=31536000, immutable"
              : "public, max-age=0, must-revalidate",
          },
        });
      }
      const blob = await ctx.storage.get(asset.storageId);
      if (blob) {
        return new Response(blob, {
          status: 200,
          headers: {
            "Content-Type": asset.contentType,
            "Cache-Control": isHashedAsset(path)
              ? "public, max-age=31536000, immutable"
              : "public, max-age=0, must-revalidate",
            ETag: etag,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
    }

    // 2. If path has a file extension and wasn't found, 404
    if (hasFileExtension(path)) {
      return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }

    // 3. SPA paths — check for bot + vanity/shortId pattern before falling back
    const ua = request.headers.get("User-Agent");
    if (isBot(ua)) {
      // /v/{shortId}
      const shortIdMatch = url.pathname.match(/^\/v\/([a-zA-Z0-9]+)\/?$/);
      if (shortIdMatch) {
        const shortId = shortIdMatch[1];
        const doc = await ctx.runQuery(api.attestations.getByShortId, { shortId });
        const title = doc?.username
          ? `${doc.username} typed this — tap to verify`
          : "Someone typed this — tap to verify";
        return new Response(buildOGPage({
          title,
          description: "Cryptographic proof from a real iPhone. Verified by KeyWitness.",
          url: `${url.origin}/v/${shortId}`,
        }), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
        });
      }

      // /{username}/{seq}
      const vanityMatch = url.pathname.match(/^\/([a-zA-Z][a-zA-Z0-9_-]{2,29})\/(\d+)\/?$/);
      if (vanityMatch) {
        const username = vanityMatch[1].toLowerCase();
        return new Response(buildOGPage({
          title: `${username} typed this — tap to verify`,
          description: "Cryptographic proof from a real iPhone. Verified by KeyWitness.",
          url: `${url.origin}/${username}/${vanityMatch[2]}`,
        }), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
        });
      }
    }

    // 4. SPA fallback — serve index.html
    return serveSPA(ctx as any);
  }),
});

export default http;
