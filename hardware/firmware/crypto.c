/**
 * KeyWitness Hardware Keyboard - Cryptographic Operations Implementation
 *
 * I2C communication with ATECC608B secure element, SHA-256 hashing via
 * mbedtls, and attestation payload construction.
 */

#include "crypto.h"

#include <string.h>
#include <stdlib.h>

#include "esp_log.h"
#include "esp_timer.h"
#include "driver/i2c.h"
#include "mbedtls/sha256.h"
#include "mbedtls/base64.h"

static const char *TAG = "kw_crypto";

/* --------------------------------------------------------------------------
 * ATECC608B Protocol Constants
 * -------------------------------------------------------------------------- */

/** CRC-16 polynomial used by ATECC608B (0x8005 reflected) */
#define ATECC_CRC_POLY              0x8005

/** Packet structure byte offsets */
#define ATECC_PKT_FUNC_IDX          0   /* Function byte (0x03 = command) */
#define ATECC_PKT_COUNT_IDX         1   /* Byte count (includes count + data + CRC) */
#define ATECC_PKT_OPCODE_IDX        2   /* Opcode */
#define ATECC_PKT_PARAM1_IDX        3   /* Param1 (1 byte) */
#define ATECC_PKT_PARAM2_IDX        4   /* Param2 (2 bytes, little-endian) */
#define ATECC_PKT_DATA_IDX          6   /* Data start (variable length) */

/** Response status codes */
#define ATECC_STATUS_SUCCESS        0x00
#define ATECC_STATUS_CHECKMAC_FAIL  0x01
#define ATECC_STATUS_PARSE_ERROR    0x03
#define ATECC_STATUS_ECC_FAULT      0x05
#define ATECC_STATUS_EXEC_ERROR     0x0F
#define ATECC_STATUS_WATCHDOG       0xEE
#define ATECC_STATUS_COMM_ERROR     0xFF

/** Typical execution times (ms) for ATECC608B commands */
#define ATECC_EXEC_TIME_SIGN_MS     60
#define ATECC_EXEC_TIME_GENKEY_MS   115
#define ATECC_EXEC_TIME_NONCE_MS    7
#define ATECC_EXEC_TIME_READ_MS     1
#define ATECC_EXEC_TIME_SHA_MS      9
#define ATECC_EXEC_TIME_COUNTER_MS  25
#define ATECC_EXEC_TIME_RANDOM_MS   23
#define ATECC_EXEC_TIME_VERIFY_MS   72
#define ATECC_EXEC_TIME_LOCK_MS     35
#define ATECC_EXEC_TIME_WRITE_MS    26
#define ATECC_EXEC_TIME_INFO_MS     1

/** Maximum I2C response size */
#define ATECC_MAX_RESPONSE_SIZE     128

/* --------------------------------------------------------------------------
 * Internal State
 * -------------------------------------------------------------------------- */

static bool s_initialized = false;
static SemaphoreHandle_t s_i2c_mutex = NULL;

/* --------------------------------------------------------------------------
 * CRC-16 Calculation (ATECC608B uses CRC-16/BUYPASS variant)
 * -------------------------------------------------------------------------- */

static uint16_t atecc_crc16(const uint8_t *data, size_t len)
{
    uint16_t crc = 0x0000;

    for (size_t i = 0; i < len; i++) {
        uint8_t shift;
        for (shift = 0x01; shift > 0x00; shift <<= 1) {
            uint8_t data_bit = (data[i] & shift) ? 1 : 0;
            uint8_t crc_bit = (crc >> 15) & 0x01;

            crc <<= 1;

            if (data_bit != crc_bit) {
                crc ^= ATECC_CRC_POLY;
            }
        }
    }

    return crc;
}

/* --------------------------------------------------------------------------
 * Low-Level I2C Communication
 * -------------------------------------------------------------------------- */

/**
 * Wake the ATECC608B from sleep.
 * Send I2C address 0x00 (general call) to create a low pulse on SDA.
 * Then wait for the wake response (0x04, 0x11, 0x33, 0x43).
 */
static esp_err_t atecc_wake(void)
{
    /* Send a zero byte to address 0x00 to create the wake condition */
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, 0x00, false); /* Don't check ACK */
    i2c_master_stop(cmd);
    i2c_master_cmd_begin(ATECC608B_I2C_PORT, cmd, pdMS_TO_TICKS(10));
    i2c_cmd_link_delete(cmd);

    /* Wait tWHI (1.5 ms) for the device to wake */
    vTaskDelay(pdMS_TO_TICKS(2));

    /* Read 4-byte wake response */
    uint8_t response[4] = {0};
    cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (ATECC608B_I2C_ADDR << 1) | I2C_MASTER_READ, true);
    i2c_master_read(cmd, response, 4, I2C_MASTER_LAST_NACK);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(ATECC608B_I2C_PORT, cmd, pdMS_TO_TICKS(10));
    i2c_cmd_link_delete(cmd);

    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ATECC608B wake failed: %s", esp_err_to_name(ret));
        return ret;
    }

    /* Verify wake response: 0x04 0x11 0x33 0x43 */
    const uint8_t expected[] = {0x04, 0x11, 0x33, 0x43};
    if (memcmp(response, expected, 4) != 0) {
        ESP_LOGE(TAG, "ATECC608B unexpected wake response: %02x %02x %02x %02x",
                 response[0], response[1], response[2], response[3]);
        return ESP_ERR_INVALID_RESPONSE;
    }

    return ESP_OK;
}

/**
 * Put the ATECC608B to sleep (lowest power mode).
 */
static esp_err_t atecc_sleep(void)
{
    uint8_t word_addr = ATECC_WORD_ADDR_SLEEP;

    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (ATECC608B_I2C_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write_byte(cmd, word_addr, true);
    i2c_master_stop(cmd);
    esp_err_t ret = i2c_master_cmd_begin(ATECC608B_I2C_PORT, cmd, pdMS_TO_TICKS(10));
    i2c_cmd_link_delete(cmd);

    return ret;
}

/**
 * Send a command to the ATECC608B and read the response.
 *
 * Packet format (to device):
 *   [0x03] [count] [opcode] [param1] [param2_lo] [param2_hi] [data...] [crc_lo] [crc_hi]
 *   count = 1(count) + 1(opcode) + 1(param1) + 2(param2) + len(data) + 2(crc)
 *
 * Response format (from device):
 *   [count] [data...] [crc_lo] [crc_hi]
 */
static esp_err_t atecc_execute(uint8_t opcode, uint8_t param1,
                                uint16_t param2, const uint8_t *data,
                                size_t data_len, uint8_t *response,
                                size_t *response_len, uint32_t exec_time_ms)
{
    esp_err_t ret;
    uint8_t packet[256];
    size_t pkt_len;

    /* Build command packet */
    uint8_t count = 7 + data_len; /* count + opcode + p1 + p2(2) + data + crc(2) */
    packet[0] = ATECC_WORD_ADDR_COMMAND; /* Word address: command */
    packet[1] = count;
    packet[2] = opcode;
    packet[3] = param1;
    packet[4] = (uint8_t)(param2 & 0xFF);
    packet[5] = (uint8_t)((param2 >> 8) & 0xFF);

    if (data != NULL && data_len > 0) {
        memcpy(&packet[6], data, data_len);
    }

    /* Calculate CRC over count..data (not including word address byte or CRC itself) */
    uint16_t crc = atecc_crc16(&packet[1], count - 2);
    packet[1 + count - 2] = (uint8_t)(crc & 0xFF);
    packet[1 + count - 1] = (uint8_t)((crc >> 8) & 0xFF);

    pkt_len = 1 + count; /* word_address + packet */

    /* Send command over I2C */
    i2c_cmd_handle_t cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (ATECC608B_I2C_ADDR << 1) | I2C_MASTER_WRITE, true);
    i2c_master_write(cmd, packet, pkt_len, true);
    i2c_master_stop(cmd);
    ret = i2c_master_cmd_begin(ATECC608B_I2C_PORT, cmd, pdMS_TO_TICKS(50));
    i2c_cmd_link_delete(cmd);

    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ATECC608B command send failed (op=0x%02x): %s",
                 opcode, esp_err_to_name(ret));
        return ret;
    }

    /* Wait for execution */
    vTaskDelay(pdMS_TO_TICKS(exec_time_ms + 2));

    /* Read response */
    uint8_t resp_buf[ATECC_MAX_RESPONSE_SIZE];
    cmd = i2c_cmd_link_create();
    i2c_master_start(cmd);
    i2c_master_write_byte(cmd, (ATECC608B_I2C_ADDR << 1) | I2C_MASTER_READ, true);
    /* First read the count byte */
    i2c_master_read_byte(cmd, &resp_buf[0], I2C_MASTER_ACK);
    i2c_master_stop(cmd);
    ret = i2c_master_cmd_begin(ATECC608B_I2C_PORT, cmd, pdMS_TO_TICKS(50));
    i2c_cmd_link_delete(cmd);

    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "ATECC608B response read failed (op=0x%02x): %s",
                 opcode, esp_err_to_name(ret));
        return ret;
    }

    uint8_t resp_count = resp_buf[0];
    if (resp_count < 4 || resp_count > ATECC_MAX_RESPONSE_SIZE) {
        ESP_LOGE(TAG, "ATECC608B invalid response count: %d", resp_count);
        return ESP_ERR_INVALID_SIZE;
    }

    /* Read remaining bytes (count - 1 already read) */
    if (resp_count > 1) {
        cmd = i2c_cmd_link_create();
        i2c_master_start(cmd);
        i2c_master_write_byte(cmd, (ATECC608B_I2C_ADDR << 1) | I2C_MASTER_READ, true);
        i2c_master_read(cmd, &resp_buf[1], resp_count - 1, I2C_MASTER_LAST_NACK);
        i2c_master_stop(cmd);
        ret = i2c_master_cmd_begin(ATECC608B_I2C_PORT, cmd, pdMS_TO_TICKS(50));
        i2c_cmd_link_delete(cmd);

        if (ret != ESP_OK) {
            return ret;
        }
    }

    /* Verify response CRC */
    uint16_t resp_crc = atecc_crc16(resp_buf, resp_count - 2);
    uint16_t recv_crc = (uint16_t)resp_buf[resp_count - 2] |
                        ((uint16_t)resp_buf[resp_count - 1] << 8);
    if (resp_crc != recv_crc) {
        ESP_LOGE(TAG, "ATECC608B response CRC mismatch: calc=0x%04x recv=0x%04x",
                 resp_crc, recv_crc);
        return ESP_ERR_INVALID_CRC;
    }

    /* Check for error status (4-byte error response) */
    if (resp_count == 4) {
        uint8_t status = resp_buf[1];
        if (status != ATECC_STATUS_SUCCESS) {
            ESP_LOGE(TAG, "ATECC608B command error (op=0x%02x): status=0x%02x",
                     opcode, status);
            return ESP_ERR_INVALID_RESPONSE;
        }
    }

    /* Copy response data (excluding count byte and CRC) */
    size_t data_size = resp_count - 3; /* Minus count(1) + CRC(2) */
    if (response != NULL && response_len != NULL) {
        if (data_size > *response_len) {
            ESP_LOGE(TAG, "Response buffer too small: need %zu, have %zu",
                     data_size, *response_len);
            return ESP_ERR_NO_MEM;
        }
        memcpy(response, &resp_buf[1], data_size);
        *response_len = data_size;
    }

    return ESP_OK;
}

/* --------------------------------------------------------------------------
 * Initialization
 * -------------------------------------------------------------------------- */

esp_err_t kw_crypto_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    ESP_LOGI(TAG, "Initializing crypto subsystem");

    /* Create I2C mutex */
    s_i2c_mutex = xSemaphoreCreateMutex();
    if (s_i2c_mutex == NULL) {
        ESP_LOGE(TAG, "Failed to create I2C mutex");
        return ESP_ERR_NO_MEM;
    }

    /* Configure I2C master */
    i2c_config_t i2c_cfg = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = 21,          /* TODO: Set actual SDA pin for your PCB */
        .scl_io_num = 22,          /* TODO: Set actual SCL pin for your PCB */
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = ATECC608B_I2C_FREQ_HZ,
    };

    esp_err_t ret = i2c_param_config(ATECC608B_I2C_PORT, &i2c_cfg);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2C config failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ret = i2c_driver_install(ATECC608B_I2C_PORT, I2C_MODE_MASTER, 0, 0, 0);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "I2C driver install failed: %s", esp_err_to_name(ret));
        return ret;
    }

    /* Wake the ATECC608B */
    ret = atecc_wake();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to wake ATECC608B");
        i2c_driver_delete(ATECC608B_I2C_PORT);
        return ret;
    }

    /* Read device info to verify communication */
    uint8_t info[4];
    size_t info_len = sizeof(info);
    ret = atecc_execute(ATECC_OP_INFO, 0x00, 0x0000, NULL, 0,
                        info, &info_len, ATECC_EXEC_TIME_INFO_MS);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read ATECC608B device info");
        atecc_sleep();
        i2c_driver_delete(ATECC608B_I2C_PORT);
        return ret;
    }

    ESP_LOGI(TAG, "ATECC608B connected, revision: %02x%02x%02x%02x",
             info[0], info[1], info[2], info[3]);

    /* Put device to idle (lower power than awake, faster than wake from sleep) */
    /* We'll wake it for each operation */
    atecc_sleep();

    s_initialized = true;
    return ESP_OK;
}

void kw_crypto_deinit(void)
{
    if (!s_initialized) {
        return;
    }

    atecc_sleep();
    i2c_driver_delete(ATECC608B_I2C_PORT);

    if (s_i2c_mutex != NULL) {
        vSemaphoreDelete(s_i2c_mutex);
        s_i2c_mutex = NULL;
    }

    s_initialized = false;
    ESP_LOGI(TAG, "Crypto subsystem deinitialized");
}

/* --------------------------------------------------------------------------
 * Device Identity
 * -------------------------------------------------------------------------- */

esp_err_t kw_crypto_get_serial(uint8_t serial[KW_SERIAL_SIZE])
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * ATECC608B serial number is split across config zone:
     *   Bytes 0-3: config zone word 0 (address 0x00)
     *   Bytes 4-8: config zone word 2-3 (address 0x02, bytes 0-4)
     *
     * Read command: opcode=0x02, param1=zone(0x00=config, bit2=32-byte),
     *               param2=address word
     */

    /* Read words 0-3 (32 bytes from config zone, address 0x00) */
    uint8_t config_block[32];
    size_t config_len = sizeof(config_block);
    ret = atecc_execute(ATECC_OP_READ,
                        0x80,      /* Zone: config, 32-byte read */
                        0x0000,    /* Address: word 0 */
                        NULL, 0,
                        config_block, &config_len,
                        ATECC_EXEC_TIME_READ_MS);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read config zone for serial");
        goto done;
    }

    /* Serial bytes: [0..3] from offset 0, [4..7] from offset 8, [8] from offset 12 */
    serial[0] = config_block[0];
    serial[1] = config_block[1];
    serial[2] = config_block[2];
    serial[3] = config_block[3];
    serial[4] = config_block[8];
    serial[5] = config_block[9];
    serial[6] = config_block[10];
    serial[7] = config_block[11];
    serial[8] = config_block[12];

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_get_pubkey(uint8_t pubkey[KW_PUBKEY_SIZE])
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * GenKey command in public key computation mode:
     * opcode=0x40, param1=0x00 (public key from existing private key),
     * param2=slot number
     *
     * This regenerates the public key from the private key in the specified slot
     * without modifying the private key.
     */
    size_t pubkey_len = KW_PUBKEY_SIZE;
    ret = atecc_execute(ATECC_OP_GENKEY,
                        0x00,                       /* Mode: compute public key */
                        KW_SLOT_ATTESTATION_PRIVKEY, /* Slot 0 */
                        NULL, 0,
                        pubkey, &pubkey_len,
                        ATECC_EXEC_TIME_GENKEY_MS);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read public key from slot %d",
                 KW_SLOT_ATTESTATION_PRIVKEY);
    }

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_get_device_identity(kw_device_identity_t *identity)
{
    if (identity == NULL) return ESP_ERR_INVALID_ARG;

    esp_err_t ret = kw_crypto_get_serial(identity->serial);
    if (ret != ESP_OK) return ret;

    ret = kw_crypto_get_pubkey(identity->public_key);
    if (ret != ESP_OK) return ret;

    /* Read revision via Info command */
    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    ret = atecc_wake();
    if (ret == ESP_OK) {
        size_t rev_len = 4;
        ret = atecc_execute(ATECC_OP_INFO, 0x00, 0x0000, NULL, 0,
                            identity->revision, &rev_len,
                            ATECC_EXEC_TIME_INFO_MS);
    }
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);

    return ret;
}

/* --------------------------------------------------------------------------
 * Signing Operations
 * -------------------------------------------------------------------------- */

esp_err_t kw_crypto_sign(const uint8_t digest[KW_HASH_SIZE],
                          uint8_t signature[KW_SIGNATURE_SIZE])
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (digest == NULL || signature == NULL) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Step 1: Load the digest into TempKey via Nonce command (passthrough mode).
     *
     * Nonce command: opcode=0x16
     *   param1=0x03 (passthrough mode: load TempKey directly with input data)
     *   param2=0x0000
     *   data: 32-byte digest
     *
     * In passthrough mode, the Nonce command loads the provided data directly
     * into TempKey without combining it with a random number.
     */
    uint8_t nonce_resp[1];
    size_t nonce_resp_len = sizeof(nonce_resp);
    ret = atecc_execute(ATECC_OP_NONCE,
                        0x03,       /* Mode: passthrough */
                        0x0000,
                        digest, KW_HASH_SIZE,
                        nonce_resp, &nonce_resp_len,
                        ATECC_EXEC_TIME_NONCE_MS);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Nonce command failed");
        goto done;
    }

    /*
     * Step 2: Sign the digest in TempKey using the private key in slot 0.
     *
     * Sign command: opcode=0x41
     *   param1=0x80 (external: sign contents of TempKey, which was loaded via Nonce)
     *   param2=slot number (key to sign with)
     *
     * Returns 64-byte ECDSA signature (r[32] || s[32]).
     */
    size_t sig_len = KW_SIGNATURE_SIZE;
    ret = atecc_execute(ATECC_OP_SIGN,
                        0x80,                        /* Mode: external (sign TempKey) */
                        KW_SLOT_ATTESTATION_PRIVKEY, /* Slot 0 */
                        NULL, 0,
                        signature, &sig_len,
                        ATECC_EXEC_TIME_SIGN_MS);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Sign command failed");
        goto done;
    }

    ESP_LOGI(TAG, "Attestation signature generated (%zu bytes)", sig_len);

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_verify(const uint8_t digest[KW_HASH_SIZE],
                            const uint8_t signature[KW_SIGNATURE_SIZE],
                            const uint8_t *pubkey)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (digest == NULL || signature == NULL) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /* Load digest into TempKey via Nonce passthrough */
    uint8_t nonce_resp[1];
    size_t nonce_resp_len = sizeof(nonce_resp);
    ret = atecc_execute(ATECC_OP_NONCE, 0x03, 0x0000,
                        digest, KW_HASH_SIZE,
                        nonce_resp, &nonce_resp_len,
                        ATECC_EXEC_TIME_NONCE_MS);
    if (ret != ESP_OK) goto done;

    /*
     * Verify command: opcode=0x45
     *
     * For external public key verification:
     *   param1=0x02 (external mode)
     *   param2=0x0004 (P-256 curve, key type)
     *   data: signature(64) + public_key(64) = 128 bytes
     *
     * For stored public key verification:
     *   param1=0x00 (stored mode)
     *   param2=slot containing public key
     *   data: signature(64)
     */
    if (pubkey != NULL) {
        /* External verification with provided public key */
        uint8_t verify_data[128];
        memcpy(verify_data, signature, KW_SIGNATURE_SIZE);
        memcpy(verify_data + KW_SIGNATURE_SIZE, pubkey, KW_PUBKEY_SIZE);

        uint8_t verify_resp[1];
        size_t verify_resp_len = sizeof(verify_resp);
        ret = atecc_execute(ATECC_OP_VERIFY,
                            0x02,      /* Mode: external */
                            0x0004,    /* Key type: P-256 */
                            verify_data, sizeof(verify_data),
                            verify_resp, &verify_resp_len,
                            ATECC_EXEC_TIME_VERIFY_MS);
    } else {
        /* Stored key verification (use slot 1) */
        uint8_t verify_resp[1];
        size_t verify_resp_len = sizeof(verify_resp);
        ret = atecc_execute(ATECC_OP_VERIFY,
                            0x00,                       /* Mode: stored */
                            KW_SLOT_ATTESTATION_PUBKEY, /* Slot 1 */
                            signature, KW_SIGNATURE_SIZE,
                            verify_resp, &verify_resp_len,
                            ATECC_EXEC_TIME_VERIFY_MS);
    }

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

/* --------------------------------------------------------------------------
 * Hashing Operations (SHA-256 via mbedtls)
 * -------------------------------------------------------------------------- */

esp_err_t kw_sha256(const uint8_t *data, size_t len, uint8_t digest[KW_HASH_SIZE])
{
    if (data == NULL || digest == NULL) return ESP_ERR_INVALID_ARG;

    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);

    int mbret = mbedtls_sha256_starts(&ctx, 0); /* 0 = SHA-256 (not SHA-224) */
    if (mbret != 0) goto fail;

    mbret = mbedtls_sha256_update(&ctx, data, len);
    if (mbret != 0) goto fail;

    mbret = mbedtls_sha256_finish(&ctx, digest);
    if (mbret != 0) goto fail;

    mbedtls_sha256_free(&ctx);
    return ESP_OK;

fail:
    mbedtls_sha256_free(&ctx);
    ESP_LOGE(TAG, "SHA-256 computation failed: %d", mbret);
    return ESP_FAIL;
}

esp_err_t kw_sha256_init(kw_sha256_ctx_t *ctx)
{
    if (ctx == NULL) return ESP_ERR_INVALID_ARG;

    mbedtls_sha256_context *mb_ctx = malloc(sizeof(mbedtls_sha256_context));
    if (mb_ctx == NULL) return ESP_ERR_NO_MEM;

    mbedtls_sha256_init(mb_ctx);
    int ret = mbedtls_sha256_starts(mb_ctx, 0);
    if (ret != 0) {
        mbedtls_sha256_free(mb_ctx);
        free(mb_ctx);
        return ESP_FAIL;
    }

    ctx->mbedtls_ctx = mb_ctx;
    return ESP_OK;
}

esp_err_t kw_sha256_update(kw_sha256_ctx_t *ctx, const uint8_t *data, size_t len)
{
    if (ctx == NULL || ctx->mbedtls_ctx == NULL) return ESP_ERR_INVALID_ARG;
    if (data == NULL && len > 0) return ESP_ERR_INVALID_ARG;

    mbedtls_sha256_context *mb_ctx = (mbedtls_sha256_context *)ctx->mbedtls_ctx;
    int ret = mbedtls_sha256_update(mb_ctx, data, len);
    return (ret == 0) ? ESP_OK : ESP_FAIL;
}

esp_err_t kw_sha256_finish(kw_sha256_ctx_t *ctx, uint8_t digest[KW_HASH_SIZE])
{
    if (ctx == NULL || ctx->mbedtls_ctx == NULL) return ESP_ERR_INVALID_ARG;

    mbedtls_sha256_context *mb_ctx = (mbedtls_sha256_context *)ctx->mbedtls_ctx;
    int ret = mbedtls_sha256_finish(mb_ctx, digest);

    mbedtls_sha256_free(mb_ctx);
    free(mb_ctx);
    ctx->mbedtls_ctx = NULL;

    return (ret == 0) ? ESP_OK : ESP_FAIL;
}

/* --------------------------------------------------------------------------
 * Monotonic Counter
 * -------------------------------------------------------------------------- */

esp_err_t kw_crypto_counter_read(uint32_t *value)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (value == NULL) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Counter command: opcode=0x24
     *   param1=0x00 (read mode)
     *   param2=counter ID (0 or 1, ATECC608B has 2 monotonic counters)
     *
     * Returns 4-byte counter value (little-endian).
     */
    uint8_t counter_buf[4];
    size_t counter_len = sizeof(counter_buf);
    ret = atecc_execute(ATECC_OP_COUNTER,
                        0x00,  /* Mode: read */
                        0x00,  /* Counter 0 */
                        NULL, 0,
                        counter_buf, &counter_len,
                        ATECC_EXEC_TIME_COUNTER_MS);
    if (ret == ESP_OK) {
        *value = (uint32_t)counter_buf[0] |
                 ((uint32_t)counter_buf[1] << 8) |
                 ((uint32_t)counter_buf[2] << 16) |
                 ((uint32_t)counter_buf[3] << 24);
    }

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_counter_increment(uint32_t *new_value)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Counter command: opcode=0x24
     *   param1=0x01 (increment mode)
     *   param2=counter ID
     *
     * Returns new 4-byte counter value after increment.
     */
    uint8_t counter_buf[4];
    size_t counter_len = sizeof(counter_buf);
    ret = atecc_execute(ATECC_OP_COUNTER,
                        0x01,  /* Mode: increment */
                        0x00,  /* Counter 0 */
                        NULL, 0,
                        counter_buf, &counter_len,
                        ATECC_EXEC_TIME_COUNTER_MS);
    if (ret == ESP_OK && new_value != NULL) {
        *new_value = (uint32_t)counter_buf[0] |
                     ((uint32_t)counter_buf[1] << 8) |
                     ((uint32_t)counter_buf[2] << 16) |
                     ((uint32_t)counter_buf[3] << 24);
    }

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

/* --------------------------------------------------------------------------
 * Random Number Generation
 * -------------------------------------------------------------------------- */

esp_err_t kw_crypto_random(uint8_t random[KW_RANDOM_SIZE])
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (random == NULL) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Random command: opcode=0x1B
     *   param1=0x00 (generate and update seed)
     *   param2=0x0000
     *
     * Returns 32 bytes of random data from hardware TRNG.
     */
    size_t rand_len = KW_RANDOM_SIZE;
    ret = atecc_execute(ATECC_OP_RANDOM,
                        0x00,      /* Mode: seed + random */
                        0x0000,
                        NULL, 0,
                        random, &rand_len,
                        ATECC_EXEC_TIME_RANDOM_MS);

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

/* --------------------------------------------------------------------------
 * Attestation
 * -------------------------------------------------------------------------- */

/**
 * Simple CBOR encoder for attestation payload.
 * Produces deterministic/canonical CBOR (smallest encoding, sorted keys).
 *
 * NOTE: This is a minimal CBOR encoder for the specific attestation format.
 * For production, consider using a proper CBOR library (e.g., tinycbor).
 */

static size_t cbor_encode_uint(uint8_t *buf, uint64_t value)
{
    if (value <= 23) {
        buf[0] = (uint8_t)value;
        return 1;
    } else if (value <= 0xFF) {
        buf[0] = 0x18;
        buf[1] = (uint8_t)value;
        return 2;
    } else if (value <= 0xFFFF) {
        buf[0] = 0x19;
        buf[1] = (uint8_t)(value >> 8);
        buf[2] = (uint8_t)value;
        return 3;
    } else if (value <= 0xFFFFFFFF) {
        buf[0] = 0x1A;
        buf[1] = (uint8_t)(value >> 24);
        buf[2] = (uint8_t)(value >> 16);
        buf[3] = (uint8_t)(value >> 8);
        buf[4] = (uint8_t)value;
        return 5;
    } else {
        buf[0] = 0x1B;
        buf[1] = (uint8_t)(value >> 56);
        buf[2] = (uint8_t)(value >> 48);
        buf[3] = (uint8_t)(value >> 40);
        buf[4] = (uint8_t)(value >> 32);
        buf[5] = (uint8_t)(value >> 24);
        buf[6] = (uint8_t)(value >> 16);
        buf[7] = (uint8_t)(value >> 8);
        buf[8] = (uint8_t)value;
        return 9;
    }
}

static size_t cbor_encode_bytes(uint8_t *buf, const uint8_t *data, size_t len)
{
    size_t offset = 0;
    /* Major type 2 (byte string) */
    offset += cbor_encode_uint(buf, len);
    buf[0] |= 0x40; /* Set major type 2 */
    memcpy(buf + offset, data, len);
    return offset + len;
}

static size_t cbor_encode_text(uint8_t *buf, const char *str)
{
    size_t len = strlen(str);
    size_t offset = 0;
    /* Major type 3 (text string) */
    offset += cbor_encode_uint(buf, len);
    buf[0] |= 0x60; /* Set major type 3 */
    memcpy(buf + offset, str, len);
    return offset + len;
}

static size_t cbor_encode_bool(uint8_t *buf, bool value)
{
    buf[0] = value ? 0xF5 : 0xF4; /* CBOR true/false */
    return 1;
}

static size_t cbor_encode_map_key(uint8_t *buf, uint64_t key)
{
    return cbor_encode_uint(buf, key);
}

/**
 * Serialize attestation payload to CBOR (without signature).
 * Returns the number of bytes written to buf.
 */
static size_t attestation_to_cbor(const kw_attestation_payload_t *payload,
                                   uint8_t *buf, size_t buf_size)
{
    size_t offset = 0;

    /* CBOR map with 11 entries (keys 1-11) */
    buf[offset++] = 0xAB; /* Map of 11 items (0xA0 | 11) */

    /* Key 1: version (uint) */
    offset += cbor_encode_map_key(buf + offset, 1);
    offset += cbor_encode_uint(buf + offset, payload->version);

    /* Key 2: device_serial (bytes) */
    offset += cbor_encode_map_key(buf + offset, 2);
    offset += cbor_encode_bytes(buf + offset, payload->device_serial, KW_SERIAL_SIZE);

    /* Key 3: counter (uint) */
    offset += cbor_encode_map_key(buf + offset, 3);
    offset += cbor_encode_uint(buf + offset, payload->counter);

    /* Key 4: timestamp (uint) */
    offset += cbor_encode_map_key(buf + offset, 4);
    offset += cbor_encode_uint(buf + offset, payload->timestamp);

    /* Key 5: cleartext (tstr) */
    offset += cbor_encode_map_key(buf + offset, 5);
    offset += cbor_encode_text(buf + offset, payload->cleartext ? payload->cleartext : "");

    /* Key 6: sensor_data_hash (bytes) */
    offset += cbor_encode_map_key(buf + offset, 6);
    offset += cbor_encode_bytes(buf + offset, payload->sensor_data_hash, KW_HASH_SIZE);

    /* Key 7: fingerprint_matched (bool) */
    offset += cbor_encode_map_key(buf + offset, 7);
    offset += cbor_encode_bool(buf + offset, payload->fingerprint_matched);

    /* Key 8: fingerprint_confidence (uint) */
    offset += cbor_encode_map_key(buf + offset, 8);
    offset += cbor_encode_uint(buf + offset, payload->fingerprint_confidence);

    /* Key 9: fingerprint_last_seen (uint) */
    offset += cbor_encode_map_key(buf + offset, 9);
    offset += cbor_encode_uint(buf + offset, payload->fingerprint_last_seen);

    /* Key 10: firmware_version (tstr) */
    offset += cbor_encode_map_key(buf + offset, 10);
    offset += cbor_encode_text(buf + offset, payload->firmware_version);

    /* Key 11: secure_boot_verified (bool) */
    offset += cbor_encode_map_key(buf + offset, 11);
    offset += cbor_encode_bool(buf + offset, payload->secure_boot_verified);

    return offset;
}

esp_err_t kw_attestation_sign(const kw_attestation_payload_t *payload,
                               kw_signed_attestation_t *attestation)
{
    if (payload == NULL || attestation == NULL) return ESP_ERR_INVALID_ARG;

    /* Copy payload into attestation */
    memcpy(&attestation->payload, payload, sizeof(kw_attestation_payload_t));

    /* Serialize payload to CBOR */
    uint8_t cbor_buf[2048];
    size_t cbor_len = attestation_to_cbor(payload, cbor_buf, sizeof(cbor_buf));

    if (cbor_len == 0) {
        ESP_LOGE(TAG, "CBOR serialization failed");
        return ESP_FAIL;
    }

    /* Hash the CBOR payload */
    uint8_t digest[KW_HASH_SIZE];
    esp_err_t ret = kw_sha256(cbor_buf, cbor_len, digest);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Payload hashing failed");
        return ret;
    }

    /* Sign the digest with the secure element */
    ret = kw_crypto_sign(digest, attestation->signature);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Attestation signing failed");
        return ret;
    }

    ESP_LOGI(TAG, "Attestation signed successfully (CBOR payload: %zu bytes)", cbor_len);
    return ESP_OK;
}

esp_err_t kw_attestation_serialize(const kw_signed_attestation_t *attestation,
                                    char *output, size_t output_size,
                                    size_t *output_len)
{
    if (attestation == NULL || output == NULL) return ESP_ERR_INVALID_ARG;

    /* Serialize to CBOR including signature as key 12 */
    uint8_t cbor_buf[2048];
    size_t offset = 0;

    /* Re-encode as map with 12 entries (payload + signature) */
    cbor_buf[offset++] = 0xAC; /* Map of 12 items */

    /* Encode the 11 payload fields */
    size_t payload_len = attestation_to_cbor(&attestation->payload,
                                              cbor_buf + 1, sizeof(cbor_buf) - 1);
    /* Skip the map header from attestation_to_cbor (we used our own) */
    memmove(cbor_buf + 1, cbor_buf + 2, payload_len - 1);
    offset = payload_len; /* Adjust for moved data */

    /* Key 12: signature (bytes) */
    offset += cbor_encode_map_key(cbor_buf + offset, 12);
    offset += cbor_encode_bytes(cbor_buf + offset, attestation->signature,
                                 KW_SIGNATURE_SIZE);

    /* Base64-encode the CBOR */
    size_t b64_len = 0;
    int ret = mbedtls_base64_encode(NULL, 0, &b64_len, cbor_buf, offset);
    /* mbedtls_base64_encode returns MBEDTLS_ERR_BASE64_BUFFER_TOO_SMALL
       and sets b64_len to required size */

    const char *header = "-----BEGIN KEYWITNESS ATTESTATION-----\n";
    const char *footer = "\n-----END KEYWITNESS ATTESTATION-----\n";
    size_t total_len = strlen(header) + b64_len + strlen(footer);

    if (total_len > output_size) {
        return ESP_ERR_NO_MEM;
    }

    /* Build output */
    size_t pos = 0;
    memcpy(output + pos, header, strlen(header));
    pos += strlen(header);

    size_t actual_b64_len = 0;
    mbedtls_base64_encode((unsigned char *)(output + pos), output_size - pos,
                           &actual_b64_len, cbor_buf, offset);
    pos += actual_b64_len;

    memcpy(output + pos, footer, strlen(footer));
    pos += strlen(footer);

    output[pos] = '\0';

    if (output_len != NULL) {
        *output_len = pos;
    }

    return ESP_OK;
}

/* --------------------------------------------------------------------------
 * Key Provisioning (Factory Use Only)
 * -------------------------------------------------------------------------- */

esp_err_t kw_crypto_provision_generate_key(uint8_t pubkey[KW_PUBKEY_SIZE])
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (pubkey == NULL) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * GenKey command: opcode=0x40
     *   param1=0x04 (create new private key and return public key)
     *   param2=slot number
     *
     * Generates a new P-256 keypair. Private key stored in slot,
     * public key (64 bytes, x||y) returned.
     */
    ESP_LOGW(TAG, "PROVISIONING: Generating new attestation keypair in slot %d",
             KW_SLOT_ATTESTATION_PRIVKEY);

    size_t pubkey_len = KW_PUBKEY_SIZE;
    ret = atecc_execute(ATECC_OP_GENKEY,
                        0x04,                        /* Mode: create new key */
                        KW_SLOT_ATTESTATION_PRIVKEY, /* Slot 0 */
                        NULL, 0,
                        pubkey, &pubkey_len,
                        ATECC_EXEC_TIME_GENKEY_MS);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Key generation failed");
    } else {
        ESP_LOGI(TAG, "New attestation keypair generated successfully");
    }

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_provision_lock(bool lock_config, bool lock_data)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Lock command: opcode=0x17
     *   param1: zone to lock
     *     0x00 = config zone
     *     0x01 = data/OTP zone
     *   param2: CRC of zone contents (0x0000 to skip CRC check)
     *
     * WARNING: Locking is IRREVERSIBLE.
     */

    if (lock_config) {
        ESP_LOGW(TAG, "PROVISIONING: Locking configuration zone (IRREVERSIBLE)");
        uint8_t lock_resp[1];
        size_t lock_resp_len = sizeof(lock_resp);
        ret = atecc_execute(ATECC_OP_LOCK,
                            0x00,      /* Zone: config */
                            0x0000,    /* Skip CRC verification */
                            NULL, 0,
                            lock_resp, &lock_resp_len,
                            ATECC_EXEC_TIME_LOCK_MS);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "Config zone lock failed");
            goto done;
        }
        ESP_LOGI(TAG, "Configuration zone locked");
    }

    if (lock_data) {
        ESP_LOGW(TAG, "PROVISIONING: Locking data zone (IRREVERSIBLE)");
        uint8_t lock_resp[1];
        size_t lock_resp_len = sizeof(lock_resp);
        ret = atecc_execute(ATECC_OP_LOCK,
                            0x01,      /* Zone: data/OTP */
                            0x0000,    /* Skip CRC verification */
                            NULL, 0,
                            lock_resp, &lock_resp_len,
                            ATECC_EXEC_TIME_LOCK_MS);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "Data zone lock failed");
            goto done;
        }
        ESP_LOGI(TAG, "Data zone locked");
    }

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_store_fingerprint_template(const uint8_t *template_data,
                                                size_t len)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (template_data == NULL || len == 0) return ESP_ERR_INVALID_ARG;
    if (len > 416) {
        ESP_LOGE(TAG, "Fingerprint template too large: %zu bytes (max 416)", len);
        return ESP_ERR_INVALID_SIZE;
    }

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Write encrypted data to slot 8.
     * Write command: opcode=0x12
     *   param1=0x82 (data zone, 32-byte write, encrypted)
     *   param2=slot address (slot 8 = block address calculated from slot)
     *
     * Data must be written in 32-byte blocks.
     */
    size_t blocks = (len + 31) / 32;
    uint8_t block_buf[32];

    for (size_t i = 0; i < blocks; i++) {
        memset(block_buf, 0, sizeof(block_buf));
        size_t copy_len = (len - i * 32 > 32) ? 32 : (len - i * 32);
        memcpy(block_buf, template_data + i * 32, copy_len);

        /* Calculate address: slot 8, block i */
        uint16_t address = (uint16_t)((KW_SLOT_FINGERPRINT_DATA << 3) | (i & 0x07));

        uint8_t write_resp[1];
        size_t write_resp_len = sizeof(write_resp);
        ret = atecc_execute(ATECC_OP_WRITE,
                            0x82,      /* Zone: data, 32-byte, encrypted */
                            address,
                            block_buf, 32,
                            write_resp, &write_resp_len,
                            ATECC_EXEC_TIME_WRITE_MS);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "Write to fingerprint slot failed at block %zu", i);
            goto done;
        }
    }

    ESP_LOGI(TAG, "Fingerprint template stored (%zu bytes, %zu blocks)", len, blocks);

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}

esp_err_t kw_crypto_read_fingerprint_template(uint8_t *template_data,
                                               size_t buf_size,
                                               size_t *len)
{
    if (!s_initialized) return ESP_ERR_INVALID_STATE;
    if (template_data == NULL || len == NULL) return ESP_ERR_INVALID_ARG;

    xSemaphoreTake(s_i2c_mutex, portMAX_DELAY);
    esp_err_t ret = atecc_wake();
    if (ret != ESP_OK) goto done;

    /*
     * Read encrypted data from slot 8.
     * Read command: opcode=0x02
     *   param1=0x82 (data zone, 32-byte read, encrypted)
     *   param2=slot address
     *
     * Read in 32-byte blocks. Max 13 blocks (416 bytes) per slot.
     */
    size_t total_read = 0;
    size_t max_blocks = buf_size / 32;
    if (max_blocks > 13) max_blocks = 13;

    for (size_t i = 0; i < max_blocks; i++) {
        uint16_t address = (uint16_t)((KW_SLOT_FINGERPRINT_DATA << 3) | (i & 0x07));

        size_t block_len = 32;
        ret = atecc_execute(ATECC_OP_READ,
                            0x82,      /* Zone: data, 32-byte, encrypted */
                            address,
                            NULL, 0,
                            template_data + total_read, &block_len,
                            ATECC_EXEC_TIME_READ_MS);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "Read from fingerprint slot failed at block %zu", i);
            goto done;
        }
        total_read += block_len;
    }

    *len = total_read;

done:
    atecc_sleep();
    xSemaphoreGive(s_i2c_mutex);
    return ret;
}
