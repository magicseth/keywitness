/**
 * KeyWitness v1 attestation builder — portable module.
 *
 * Pure C, no Arduino/ESP dependencies, so the exact bytes the device signs
 * can be compiled and verified on a host machine against the server's
 * verification code (web/convex/lib/verify.ts). See teensy/test/.
 *
 * CANONICALIZATION: the server (verifyAttestationServerSide) verifies the
 * Ed25519 signature over the RFC 8785 JCS canonicalization of the payload —
 * i.e. alphabetically sorted keys with JSON.stringify escaping:
 *
 *   {"cleartext":...,"deviceId":...,"keystrokeBiometricsHash":...,
 *    "timestamp":...,"version":1}
 *
 * NOTE: this differs from shared/attestation.ts buildSigningPayload(), which
 * uses a fixed (non-sorted) field order. The server is the authority for
 * minting URLs, so we match the server.
 */

#ifndef KW_ATTESTATION_V1_H
#define KW_ATTESTATION_V1_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define KW_SIGNATURE_LEN 64
#define KW_PUBKEY_LEN 32

typedef struct {
    const char *cleartext;                 /* UTF-8, may contain newlines etc. */
    const char *device_id;
    const char *timestamp;                 /* ISO 8601, e.g. 2026-07-07T20:00:00.000Z */
    const char *keystroke_biometrics_hash; /* hex SHA-256 of the timing record */
} kw_v1_fields_t;

/**
 * All builders return the number of bytes written (excluding the NUL
 * terminator, which IS written), or 0 if the output buffer was too small.
 */

/** JSON string-escape `in` into `out` (no surrounding quotes). */
size_t kw_json_escape(const char *in, char *out, size_t out_size);

/** Base64url (no padding) encode. */
size_t kw_base64url_encode(const uint8_t *in, size_t in_len,
                           char *out, size_t out_size);

/** The exact byte string to be Ed25519-signed (JCS canonical payload). */
size_t kw_build_signing_payload(const kw_v1_fields_t *f,
                                char *out, size_t out_size);

/** Full attestation JSON: payload fields + signature + publicKey (base64url). */
size_t kw_build_attestation_json(const kw_v1_fields_t *f,
                                 const uint8_t sig[KW_SIGNATURE_LEN],
                                 const uint8_t pub[KW_PUBKEY_LEN],
                                 char *out, size_t out_size);

/**
 * Single-line base64url of the full attestation JSON — the payload of the
 * PEM block. Transport wraps it as:
 *   -----BEGIN KEYWITNESS ATTESTATION-----\n<b64>\n-----END KEYWITNESS ATTESTATION-----
 * `scratch` must be large enough for the intermediate JSON.
 */
size_t kw_build_attestation_block_b64(const kw_v1_fields_t *f,
                                      const uint8_t sig[KW_SIGNATURE_LEN],
                                      const uint8_t pub[KW_PUBKEY_LEN],
                                      char *scratch, size_t scratch_size,
                                      char *out, size_t out_size);

#ifdef __cplusplus
}
#endif

#endif /* KW_ATTESTATION_V1_H */
