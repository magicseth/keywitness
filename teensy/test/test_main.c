/**
 * Host-side test shim for attestation_v1.c — compiled natively so the exact
 * bytes the Teensy signs can be checked against the server's verifier.
 *
 * Usage:  kw_test <mode>
 *   Input on stdin: NUL-separated fields
 *     payload:     cleartext \0 deviceId \0 timestamp \0 bioHash
 *     attestation: cleartext \0 deviceId \0 timestamp \0 bioHash \0 sigHex \0 pubHex
 *     block:       (same fields as attestation, outputs base64url line)
 *     b64:         hex bytes (single field)
 *   Output on stdout: raw bytes, no trailing newline.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "../KeyWitnessForward/attestation_v1.h"

#define MAX_FIELDS 8
#define IN_MAX (1024 * 1024)
#define OUT_MAX (4 * 1024 * 1024)

static int hex_decode(const char *hex, uint8_t *out, size_t out_len)
{
    if (strlen(hex) != out_len * 2) return -1;
    for (size_t i = 0; i < out_len; i++) {
        unsigned v;
        if (sscanf(hex + i * 2, "%2x", &v) != 1) return -1;
        out[i] = (uint8_t)v;
    }
    return 0;
}

int main(int argc, char **argv)
{
    if (argc != 2) {
        fprintf(stderr, "usage: %s payload|attestation|block|b64\n", argv[0]);
        return 2;
    }
    const char *mode = argv[1];

    static char input[IN_MAX];
    size_t in_len = fread(input, 1, sizeof(input) - 1, stdin);
    input[in_len] = '\0';

    /* Split on NUL */
    const char *fields[MAX_FIELDS] = {0};
    size_t nfields = 0, pos = 0;
    while (pos <= in_len && nfields < MAX_FIELDS) {
        fields[nfields++] = &input[pos];
        pos += strlen(&input[pos]) + 1;
    }

    static char out[OUT_MAX];
    static char scratch[OUT_MAX];
    size_t out_len = 0;

    if (strcmp(mode, "payload_v2") == 0 || strcmp(mode, "block_v2") == 0) {
        /* fields: cleartextHash, encryptedCleartext, deviceId, timestamp,
         *         bioHash, faceIdVerified("0"/"1") [, sigHex, pubHex] */
        if (nfields < 6) { fprintf(stderr, "v2 needs 6+ fields\n"); return 2; }
        kw_v2_fields_t f = {
            .cleartext_hash = fields[0],
            .encrypted_cleartext = fields[1],
            .device_id = fields[2],
            .timestamp = fields[3],
            .keystroke_biometrics_hash = fields[4],
            .face_id_verified = (fields[5][0] == '1'),
        };
        if (strcmp(mode, "payload_v2") == 0) {
            out_len = kw_build_signing_payload_v2(&f, out, sizeof(out));
        } else {
            if (nfields < 8) { fprintf(stderr, "block_v2 needs sigHex, pubHex\n"); return 2; }
            uint8_t sig[KW_SIGNATURE_LEN], pub[KW_PUBKEY_LEN];
            if (hex_decode(fields[6], sig, sizeof(sig)) != 0 ||
                hex_decode(fields[7], pub, sizeof(pub)) != 0) {
                fprintf(stderr, "bad sig/pub hex\n"); return 2;
            }
            out_len = kw_build_attestation_block_b64_v2(&f, sig, pub,
                                                        scratch, sizeof(scratch),
                                                        out, sizeof(out));
        }
    } else if (strcmp(mode, "b64") == 0) {
        if (nfields < 1) return 2;
        size_t byte_len = strlen(fields[0]) / 2;
        uint8_t *bytes = malloc(byte_len ? byte_len : 1);
        if (hex_decode(fields[0], bytes, byte_len) != 0) {
            fprintf(stderr, "bad hex\n");
            return 2;
        }
        out_len = kw_base64url_encode(bytes, byte_len, out, sizeof(out));
        free(bytes);
        if (byte_len == 0) return 0; /* empty input -> legitimately empty output */
    } else {
        if (nfields < 4) {
            fprintf(stderr, "need 4+ fields, got %zu\n", nfields);
            return 2;
        }
        kw_v1_fields_t f = {
            .cleartext = fields[0],
            .device_id = fields[1],
            .timestamp = fields[2],
            .keystroke_biometrics_hash = fields[3],
        };

        if (strcmp(mode, "payload") == 0) {
            out_len = kw_build_signing_payload(&f, out, sizeof(out));
        } else {
            if (nfields < 6) {
                fprintf(stderr, "attestation/block need sigHex and pubHex\n");
                return 2;
            }
            uint8_t sig[KW_SIGNATURE_LEN], pub[KW_PUBKEY_LEN];
            if (hex_decode(fields[4], sig, sizeof(sig)) != 0 ||
                hex_decode(fields[5], pub, sizeof(pub)) != 0) {
                fprintf(stderr, "bad sig/pub hex\n");
                return 2;
            }
            if (strcmp(mode, "attestation") == 0) {
                out_len = kw_build_attestation_json(&f, sig, pub, out, sizeof(out));
            } else if (strcmp(mode, "block") == 0) {
                out_len = kw_build_attestation_block_b64(&f, sig, pub,
                                                         scratch, sizeof(scratch),
                                                         out, sizeof(out));
            } else {
                fprintf(stderr, "unknown mode: %s\n", mode);
                return 2;
            }
        }
    }

    if (out_len == 0) {
        fprintf(stderr, "builder returned 0 (overflow?)\n");
        return 1;
    }

    fwrite(out, 1, out_len, stdout);
    return 0;
}
