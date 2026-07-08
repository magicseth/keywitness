/**
 * KeyWitness v1 attestation builder — portable implementation.
 * See attestation_v1.h for the canonicalization contract.
 */

#include "attestation_v1.h"

#include <string.h>

/* ------------------------------------------------------------------------ */
/* Bounded writer                                                            */
/* ------------------------------------------------------------------------ */

typedef struct {
    char *buf;
    size_t size;
    size_t pos;
    int overflow;
} kw_writer_t;

static void w_init(kw_writer_t *w, char *buf, size_t size)
{
    w->buf = buf;
    w->size = size;
    w->pos = 0;
    w->overflow = (buf == NULL || size == 0);
}

static void w_byte(kw_writer_t *w, char c)
{
    if (w->overflow) return;
    if (w->pos + 1 >= w->size) { /* keep room for NUL */
        w->overflow = 1;
        return;
    }
    w->buf[w->pos++] = c;
}

static void w_lit(kw_writer_t *w, const char *s)
{
    while (*s) w_byte(w, *s++);
}

/** Finish: NUL-terminate and return length, or 0 on overflow. */
static size_t w_finish(kw_writer_t *w)
{
    if (w->overflow) {
        if (w->buf != NULL && w->size > 0) w->buf[0] = '\0';
        return 0;
    }
    w->buf[w->pos] = '\0';
    return w->pos;
}

/* ------------------------------------------------------------------------ */
/* JSON escaping (RFC 8785 / JSON.stringify semantics)                       */
/*                                                                           */
/* Escaped: `"` and `\`, the shorthand controls \b \t \n \f \r, and all      */
/* other control chars < 0x20 as \u00xx (lowercase hex). Everything else,    */
/* including UTF-8 multibyte sequences, passes through verbatim.             */
/* ------------------------------------------------------------------------ */

static const char HEX_LC[] = "0123456789abcdef";

static void w_json_escaped(kw_writer_t *w, const char *in)
{
    for (const unsigned char *p = (const unsigned char *)in; *p; p++) {
        unsigned char c = *p;
        switch (c) {
            case '"':  w_lit(w, "\\\""); break;
            case '\\': w_lit(w, "\\\\"); break;
            case '\b': w_lit(w, "\\b");  break;
            case '\t': w_lit(w, "\\t");  break;
            case '\n': w_lit(w, "\\n");  break;
            case '\f': w_lit(w, "\\f");  break;
            case '\r': w_lit(w, "\\r");  break;
            default:
                if (c < 0x20) {
                    w_lit(w, "\\u00");
                    w_byte(w, HEX_LC[(c >> 4) & 0x0F]);
                    w_byte(w, HEX_LC[c & 0x0F]);
                } else {
                    w_byte(w, (char)c);
                }
                break;
        }
    }
}

/** `"key":"escaped-value"` */
static void w_string_field(kw_writer_t *w, const char *key, const char *value)
{
    w_byte(w, '"');
    w_lit(w, key);
    w_lit(w, "\":\"");
    w_json_escaped(w, value != NULL ? value : "");
    w_byte(w, '"');
}

/** `"key":true` / `"key":false` (JCS boolean, no quotes) */
static void w_bool_field(kw_writer_t *w, const char *key, int value)
{
    w_byte(w, '"');
    w_lit(w, key);
    w_lit(w, "\":");
    w_lit(w, value ? "true" : "false");
}

size_t kw_json_escape(const char *in, char *out, size_t out_size)
{
    kw_writer_t w;
    w_init(&w, out, out_size);
    w_json_escaped(&w, in);
    return w_finish(&w);
}

/* ------------------------------------------------------------------------ */
/* Base64url (no padding)                                                    */
/* ------------------------------------------------------------------------ */

static const char B64URL[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

size_t kw_base64url_encode(const uint8_t *in, size_t in_len,
                           char *out, size_t out_size)
{
    kw_writer_t w;
    w_init(&w, out, out_size);

    size_t i = 0;
    while (i + 3 <= in_len) {
        uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8) | in[i + 2];
        w_byte(&w, B64URL[(v >> 18) & 0x3F]);
        w_byte(&w, B64URL[(v >> 12) & 0x3F]);
        w_byte(&w, B64URL[(v >> 6) & 0x3F]);
        w_byte(&w, B64URL[v & 0x3F]);
        i += 3;
    }
    if (in_len - i == 1) {
        uint32_t v = (uint32_t)in[i] << 16;
        w_byte(&w, B64URL[(v >> 18) & 0x3F]);
        w_byte(&w, B64URL[(v >> 12) & 0x3F]);
    } else if (in_len - i == 2) {
        uint32_t v = ((uint32_t)in[i] << 16) | ((uint32_t)in[i + 1] << 8);
        w_byte(&w, B64URL[(v >> 18) & 0x3F]);
        w_byte(&w, B64URL[(v >> 12) & 0x3F]);
        w_byte(&w, B64URL[(v >> 6) & 0x3F]);
    }

    return w_finish(&w);
}

/* ------------------------------------------------------------------------ */
/* Payload / attestation builders                                            */
/* ------------------------------------------------------------------------ */

/*
 * JCS sorts keys alphabetically. For the v1 payload (no optional fields on
 * hardware) the order is:
 *   cleartext < deviceId < keystrokeBiometricsHash < timestamp < version
 * and with signature fields added:
 *   ... < publicKey < signature < timestamp < version
 */

static void w_payload_fields(kw_writer_t *w, const kw_v1_fields_t *f)
{
    w_string_field(w, "cleartext", f->cleartext);
    w_byte(w, ',');
    w_string_field(w, "deviceId", f->device_id);
    w_byte(w, ',');
    w_string_field(w, "keystrokeBiometricsHash", f->keystroke_biometrics_hash);
}

size_t kw_build_signing_payload(const kw_v1_fields_t *f,
                                char *out, size_t out_size)
{
    kw_writer_t w;
    w_init(&w, out, out_size);

    w_byte(&w, '{');
    w_payload_fields(&w, f);
    w_byte(&w, ',');
    w_string_field(&w, "timestamp", f->timestamp);
    w_lit(&w, ",\"version\":1}");

    return w_finish(&w);
}

size_t kw_build_attestation_json(const kw_v1_fields_t *f,
                                 const uint8_t sig[KW_SIGNATURE_LEN],
                                 const uint8_t pub[KW_PUBKEY_LEN],
                                 char *out, size_t out_size)
{
    char sig_b64[((KW_SIGNATURE_LEN + 2) / 3) * 4 + 1];
    char pub_b64[((KW_PUBKEY_LEN + 2) / 3) * 4 + 1];

    if (kw_base64url_encode(sig, KW_SIGNATURE_LEN, sig_b64, sizeof(sig_b64)) == 0)
        return 0;
    if (kw_base64url_encode(pub, KW_PUBKEY_LEN, pub_b64, sizeof(pub_b64)) == 0)
        return 0;

    kw_writer_t w;
    w_init(&w, out, out_size);

    w_byte(&w, '{');
    w_payload_fields(&w, f);
    w_byte(&w, ',');
    w_string_field(&w, "publicKey", pub_b64);
    w_byte(&w, ',');
    w_string_field(&w, "signature", sig_b64);
    w_byte(&w, ',');
    w_string_field(&w, "timestamp", f->timestamp);
    w_lit(&w, ",\"version\":1}");

    return w_finish(&w);
}

size_t kw_build_attestation_block_b64(const kw_v1_fields_t *f,
                                      const uint8_t sig[KW_SIGNATURE_LEN],
                                      const uint8_t pub[KW_PUBKEY_LEN],
                                      char *scratch, size_t scratch_size,
                                      char *out, size_t out_size)
{
    size_t json_len = kw_build_attestation_json(f, sig, pub, scratch, scratch_size);
    if (json_len == 0) return 0;

    return kw_base64url_encode((const uint8_t *)scratch, json_len, out, out_size);
}

/* ------------------------------------------------------------------------ */
/* v2 (encrypted) builders                                                   */
/*                                                                           */
/* JCS-sorted keys for the signed payload:                                   */
/*   cleartextHash < deviceId < encryptedCleartext < faceIdVerified          */
/*   < keystrokeBiometricsHash < timestamp < version                         */
/* Full attestation inserts publicKey and signature (p, s) before timestamp. */
/* version value is the string "keywitness-v2".                              */
/* ------------------------------------------------------------------------ */

#define KW_V2_VERSION "keywitness-v2"

static void w_payload_fields_v2(kw_writer_t *w, const kw_v2_fields_t *f)
{
    w_string_field(w, "cleartextHash", f->cleartext_hash);
    w_byte(w, ',');
    w_string_field(w, "deviceId", f->device_id);
    w_byte(w, ',');
    w_string_field(w, "encryptedCleartext", f->encrypted_cleartext);
    w_byte(w, ',');
    w_bool_field(w, "faceIdVerified", f->face_id_verified);
    w_byte(w, ',');
    w_string_field(w, "keystrokeBiometricsHash", f->keystroke_biometrics_hash);
}

size_t kw_build_signing_payload_v2(const kw_v2_fields_t *f,
                                   char *out, size_t out_size)
{
    kw_writer_t w;
    w_init(&w, out, out_size);

    w_byte(&w, '{');
    w_payload_fields_v2(&w, f);
    w_byte(&w, ',');
    w_string_field(&w, "timestamp", f->timestamp);
    w_lit(&w, ",\"version\":\"" KW_V2_VERSION "\"}");

    return w_finish(&w);
}

size_t kw_build_attestation_json_v2(const kw_v2_fields_t *f,
                                    const uint8_t sig[KW_SIGNATURE_LEN],
                                    const uint8_t pub[KW_PUBKEY_LEN],
                                    char *out, size_t out_size)
{
    char sig_b64[((KW_SIGNATURE_LEN + 2) / 3) * 4 + 1];
    char pub_b64[((KW_PUBKEY_LEN + 2) / 3) * 4 + 1];

    if (kw_base64url_encode(sig, KW_SIGNATURE_LEN, sig_b64, sizeof(sig_b64)) == 0)
        return 0;
    if (kw_base64url_encode(pub, KW_PUBKEY_LEN, pub_b64, sizeof(pub_b64)) == 0)
        return 0;

    kw_writer_t w;
    w_init(&w, out, out_size);

    w_byte(&w, '{');
    w_payload_fields_v2(&w, f);
    w_byte(&w, ',');
    w_string_field(&w, "publicKey", pub_b64);
    w_byte(&w, ',');
    w_string_field(&w, "signature", sig_b64);
    w_byte(&w, ',');
    w_string_field(&w, "timestamp", f->timestamp);
    w_lit(&w, ",\"version\":\"" KW_V2_VERSION "\"}");

    return w_finish(&w);
}

size_t kw_build_attestation_block_b64_v2(const kw_v2_fields_t *f,
                                         const uint8_t sig[KW_SIGNATURE_LEN],
                                         const uint8_t pub[KW_PUBKEY_LEN],
                                         char *scratch, size_t scratch_size,
                                         char *out, size_t out_size)
{
    size_t json_len = kw_build_attestation_json_v2(f, sig, pub, scratch, scratch_size);
    if (json_len == 0) return 0;

    return kw_base64url_encode((const uint8_t *)scratch, json_len, out, out_size);
}
