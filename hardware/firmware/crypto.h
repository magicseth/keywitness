/**
 * KeyWitness Hardware Keyboard - Cryptographic Operations
 *
 * Interface to the ATECC608B secure element for Ed25519/ECDSA signing,
 * SHA-256 hashing, and device identity operations.
 *
 * The ATECC608B communicates over I2C (default address 0x60) and provides
 * hardware-backed key storage, signing, and monotonic counters.
 */

#ifndef KEYWITNESS_CRYPTO_H
#define KEYWITNESS_CRYPTO_H

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/* --------------------------------------------------------------------------
 * Constants
 * -------------------------------------------------------------------------- */

/** ATECC608B I2C address (7-bit, unshifted) */
#define ATECC608B_I2C_ADDR          0x60

/** I2C bus used for secure element */
#define ATECC608B_I2C_PORT          I2C_NUM_0

/** I2C clock speed for ATECC608B (max 1 MHz, use 400 kHz for reliability) */
#define ATECC608B_I2C_FREQ_HZ      400000

/** ATECC608B word address bytes */
#define ATECC_WORD_ADDR_RESET       0x00
#define ATECC_WORD_ADDR_SLEEP       0x01
#define ATECC_WORD_ADDR_IDLE        0x02
#define ATECC_WORD_ADDR_COMMAND     0x03

/** ATECC608B opcodes */
#define ATECC_OP_INFO               0x30
#define ATECC_OP_READ               0x02
#define ATECC_OP_WRITE              0x12
#define ATECC_OP_GENKEY             0x40
#define ATECC_OP_SIGN               0x41
#define ATECC_OP_VERIFY             0x45
#define ATECC_OP_NONCE              0x16
#define ATECC_OP_SHA                0x47
#define ATECC_OP_COUNTER            0x24
#define ATECC_OP_RANDOM             0x1B
#define ATECC_OP_LOCK               0x17

/** Key slot assignments */
#define KW_SLOT_ATTESTATION_PRIVKEY 0   /* ECDSA P-256 private key for signing */
#define KW_SLOT_ATTESTATION_PUBKEY  1   /* Corresponding public key */
#define KW_SLOT_PROVISIONING_KEY    2   /* ECDH provisioning (factory) */
#define KW_SLOT_FW_VERIFY_PUBKEY    3   /* Firmware update public key */
#define KW_SLOT_FINGERPRINT_DATA    8   /* Encrypted fingerprint template */
#define KW_SLOT_COUNTER             9   /* Monotonic counter */

/** Sizes */
#define KW_SERIAL_SIZE              9   /* ATECC608B serial number: 9 bytes */
#define KW_PUBKEY_SIZE              64  /* P-256 uncompressed public key (x,y) */
#define KW_SIGNATURE_SIZE           64  /* ECDSA P-256 signature (r,s) */
#define KW_HASH_SIZE                32  /* SHA-256 digest */
#define KW_RANDOM_SIZE              32  /* Random number from ATECC608B */

/** Attestation version */
#define KW_ATTESTATION_VERSION      1

/* --------------------------------------------------------------------------
 * Data Types
 * -------------------------------------------------------------------------- */

/** Device identity information retrieved from secure element */
typedef struct {
    uint8_t serial[KW_SERIAL_SIZE];       /* Unique 72-bit device serial */
    uint8_t public_key[KW_PUBKEY_SIZE];   /* Attestation public key (P-256) */
    uint8_t revision[4];                  /* ATECC608B revision bytes */
} kw_device_identity_t;

/** Attestation payload (pre-signing) */
typedef struct {
    uint8_t  version;                     /* Attestation format version */
    uint8_t  device_serial[KW_SERIAL_SIZE];
    uint32_t counter;                     /* Monotonic counter value */
    uint64_t timestamp;                   /* Unix timestamp (seconds) */
    char    *cleartext;                   /* Typed text (UTF-8, null-terminated) */
    uint8_t  sensor_data_hash[KW_HASH_SIZE]; /* SHA-256 of capacitive data */
    bool     fingerprint_matched;
    uint8_t  fingerprint_confidence;      /* 0-100 */
    uint64_t fingerprint_last_seen;       /* Unix timestamp of last match */
    char     firmware_version[16];        /* e.g., "1.0.0" */
    bool     secure_boot_verified;
} kw_attestation_payload_t;

/** Signed attestation (payload + signature) */
typedef struct {
    kw_attestation_payload_t payload;
    uint8_t signature[KW_SIGNATURE_SIZE]; /* ECDSA P-256 signature */
} kw_signed_attestation_t;

/** SHA-256 streaming context wrapper */
typedef struct {
    void *mbedtls_ctx;  /* Opaque pointer to mbedtls_sha256_context */
} kw_sha256_ctx_t;

/* --------------------------------------------------------------------------
 * Initialization
 * -------------------------------------------------------------------------- */

/**
 * Initialize the crypto subsystem.
 * Sets up I2C communication with the ATECC608B and wakes the device.
 *
 * @return ESP_OK on success, error code otherwise.
 */
esp_err_t kw_crypto_init(void);

/**
 * Deinitialize the crypto subsystem.
 * Puts the ATECC608B to sleep and releases I2C resources.
 */
void kw_crypto_deinit(void);

/* --------------------------------------------------------------------------
 * Device Identity
 * -------------------------------------------------------------------------- */

/**
 * Read the device serial number from the ATECC608B config zone.
 * Serial is 9 bytes: bytes 0-3 from word 0, bytes 4-7 from word 2-3.
 *
 * @param[out] serial   Buffer to receive 9-byte serial number.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_get_serial(uint8_t serial[KW_SERIAL_SIZE]);

/**
 * Read the attestation public key from the secure element.
 *
 * @param[out] pubkey   Buffer to receive 64-byte uncompressed P-256 public key.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_get_pubkey(uint8_t pubkey[KW_PUBKEY_SIZE]);

/**
 * Read full device identity (serial + public key + revision).
 *
 * @param[out] identity  Pointer to identity struct to fill.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_get_device_identity(kw_device_identity_t *identity);

/* --------------------------------------------------------------------------
 * Signing Operations
 * -------------------------------------------------------------------------- */

/**
 * Sign a 32-byte SHA-256 digest using the attestation private key (slot 0).
 *
 * The digest must be loaded into TempKey via the Nonce command first.
 * This function handles the full sequence: Nonce(passthrough) -> Sign(external).
 *
 * @param[in]  digest     32-byte SHA-256 hash to sign.
 * @param[out] signature  64-byte ECDSA P-256 signature (r || s).
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_sign(const uint8_t digest[KW_HASH_SIZE],
                          uint8_t signature[KW_SIGNATURE_SIZE]);

/**
 * Verify an ECDSA P-256 signature against a digest and public key.
 *
 * Can use either a stored public key (from a slot) or an external public key.
 *
 * @param[in] digest     32-byte SHA-256 hash that was signed.
 * @param[in] signature  64-byte ECDSA P-256 signature to verify.
 * @param[in] pubkey     64-byte public key (NULL to use slot 1 stored key).
 * @return ESP_OK if signature is valid, ESP_ERR_INVALID_RESPONSE if invalid.
 */
esp_err_t kw_crypto_verify(const uint8_t digest[KW_HASH_SIZE],
                            const uint8_t signature[KW_SIGNATURE_SIZE],
                            const uint8_t *pubkey);

/* --------------------------------------------------------------------------
 * Hashing Operations (SHA-256)
 * -------------------------------------------------------------------------- */

/**
 * Compute SHA-256 hash of a buffer in one shot.
 *
 * Uses mbedtls (bundled with ESP-IDF) for software SHA-256.
 *
 * @param[in]  data    Input data buffer.
 * @param[in]  len     Length of input data in bytes.
 * @param[out] digest  32-byte output hash.
 * @return ESP_OK on success.
 */
esp_err_t kw_sha256(const uint8_t *data, size_t len,
                     uint8_t digest[KW_HASH_SIZE]);

/**
 * Initialize a streaming SHA-256 context for incremental hashing.
 *
 * @param[out] ctx  SHA-256 context to initialize.
 * @return ESP_OK on success.
 */
esp_err_t kw_sha256_init(kw_sha256_ctx_t *ctx);

/**
 * Feed data into a streaming SHA-256 context.
 *
 * @param[in,out] ctx   SHA-256 context.
 * @param[in]     data  Data to hash.
 * @param[in]     len   Length of data in bytes.
 * @return ESP_OK on success.
 */
esp_err_t kw_sha256_update(kw_sha256_ctx_t *ctx,
                            const uint8_t *data, size_t len);

/**
 * Finalize a streaming SHA-256 context and produce the digest.
 *
 * @param[in,out] ctx     SHA-256 context (freed after this call).
 * @param[out]    digest  32-byte output hash.
 * @return ESP_OK on success.
 */
esp_err_t kw_sha256_finish(kw_sha256_ctx_t *ctx,
                            uint8_t digest[KW_HASH_SIZE]);

/* --------------------------------------------------------------------------
 * Monotonic Counter
 * -------------------------------------------------------------------------- */

/**
 * Read the current monotonic counter value from the ATECC608B.
 *
 * @param[out] value  Current counter value.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_counter_read(uint32_t *value);

/**
 * Increment the monotonic counter and return the new value.
 *
 * @param[out] new_value  Counter value after increment (can be NULL).
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_counter_increment(uint32_t *new_value);

/* --------------------------------------------------------------------------
 * Random Number Generation
 * -------------------------------------------------------------------------- */

/**
 * Generate 32 bytes of random data from the ATECC608B hardware RNG.
 *
 * @param[out] random  32-byte buffer for random data.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_random(uint8_t random[KW_RANDOM_SIZE]);

/* --------------------------------------------------------------------------
 * Attestation
 * -------------------------------------------------------------------------- */

/**
 * Build and sign a complete attestation payload.
 *
 * Serializes the payload to canonical CBOR, hashes it, signs with the
 * attestation key, and returns the complete signed attestation.
 *
 * @param[in]  payload      Attestation payload to sign.
 * @param[out] attestation  Signed attestation output.
 * @return ESP_OK on success.
 */
esp_err_t kw_attestation_sign(const kw_attestation_payload_t *payload,
                               kw_signed_attestation_t *attestation);

/**
 * Serialize a signed attestation to base64-encoded output with
 * BEGIN/END markers suitable for USB HID output.
 *
 * @param[in]  attestation  Signed attestation to serialize.
 * @param[out] output       Output buffer (caller-allocated).
 * @param[in]  output_size  Size of output buffer.
 * @param[out] output_len   Actual length written (can be NULL).
 * @return ESP_OK on success, ESP_ERR_NO_MEM if buffer too small.
 */
esp_err_t kw_attestation_serialize(const kw_signed_attestation_t *attestation,
                                    char *output, size_t output_size,
                                    size_t *output_len);

/* --------------------------------------------------------------------------
 * Key Provisioning (Factory Use Only)
 * -------------------------------------------------------------------------- */

/**
 * Generate a new attestation keypair in the ATECC608B.
 * This should only be called during factory provisioning.
 * The private key is generated inside the secure element and never exported.
 *
 * @param[out] pubkey  64-byte public key of the generated keypair.
 * @return ESP_OK on success, ESP_ERR_INVALID_STATE if slot already locked.
 */
esp_err_t kw_crypto_provision_generate_key(uint8_t pubkey[KW_PUBKEY_SIZE]);

/**
 * Lock the ATECC608B configuration and data zones after provisioning.
 * WARNING: This is irreversible. The device configuration cannot be
 * changed after locking.
 *
 * @param lock_config  Lock the configuration zone.
 * @param lock_data    Lock the data zone.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_provision_lock(bool lock_config, bool lock_data);

/**
 * Write an encrypted fingerprint template to the secure element.
 *
 * @param[in] template_data  Encrypted fingerprint template.
 * @param[in] len            Length of template data (max 416 bytes per slot).
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_store_fingerprint_template(const uint8_t *template_data,
                                                size_t len);

/**
 * Read the encrypted fingerprint template from the secure element.
 *
 * @param[out] template_data  Buffer to receive template.
 * @param[in]  buf_size       Size of buffer.
 * @param[out] len            Actual length of template data.
 * @return ESP_OK on success.
 */
esp_err_t kw_crypto_read_fingerprint_template(uint8_t *template_data,
                                               size_t buf_size,
                                               size_t *len);

#ifdef __cplusplus
}
#endif

#endif /* KEYWITNESS_CRYPTO_H */
