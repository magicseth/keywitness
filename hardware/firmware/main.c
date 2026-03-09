/**
 * KeyWitness Hardware Keyboard - Main Firmware
 *
 * ESP-IDF application for the KeyWitness attestation keyboard.
 * Implements USB HID keyboard, per-key capacitive touch sensing,
 * fingerprint reader interface, and cryptographic attestation.
 *
 * Target: ESP32-S3
 * Framework: ESP-IDF v5.1+
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>

/* ESP-IDF includes */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "freertos/event_groups.h"

#include "esp_log.h"
#include "esp_err.h"
#include "esp_system.h"
#include "esp_timer.h"
#include "esp_secure_boot.h"
#include "nvs_flash.h"

#include "driver/gpio.h"
#include "driver/i2c.h"
#include "driver/spi_master.h"
#include "driver/touch_pad.h"

#include "tinyusb.h"
#include "class/hid/hid_device.h"

/* Project includes */
#include "crypto.h"

static const char *TAG = "kw_main";

/* --------------------------------------------------------------------------
 * Configuration Constants
 * -------------------------------------------------------------------------- */

/** Firmware version string */
#define KW_FIRMWARE_VERSION         "0.1.0"

/** Keyboard matrix dimensions */
#define KW_MATRIX_ROWS              6
#define KW_MATRIX_COLS              17

/** Maximum keystroke buffer size */
#define KW_KEYSTROKE_BUFFER_SIZE    4096

/** Capacitive sensor sampling rate target (Hz) */
#define KW_CAP_SAMPLE_RATE_HZ      1000

/** Fingerprint sensor polling interval (ms) */
#define KW_FP_POLL_INTERVAL_MS      2000

/** ATTEST key position in matrix (row, col) */
#define KW_ATTEST_KEY_ROW           0
#define KW_ATTEST_KEY_COL           16

/** LED GPIO for ATTEST key indicator */
#define KW_ATTEST_LED_RED_GPIO      48   /* TODO: Assign actual GPIO */
#define KW_ATTEST_LED_GREEN_GPIO    47   /* TODO: Assign actual GPIO */

/** Analog multiplexer control GPIOs (CD74HC4067) */
#define KW_MUX_S0_GPIO             4    /* TODO: Assign actual GPIOs */
#define KW_MUX_S1_GPIO             5
#define KW_MUX_S2_GPIO             6
#define KW_MUX_S3_GPIO             7
#define KW_MUX_EN_GPIO             15

/** Keyboard matrix GPIO assignments */
/* TODO: Assign actual row/column GPIOs based on PCB layout */
static const int kw_row_gpios[KW_MATRIX_ROWS] = {36, 37, 38, 39, 40, 41};
static const int kw_col_gpios[KW_MATRIX_COLS] = {
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17
};

/** USB HID report descriptor for keyboard + custom attestation */
static const uint8_t kw_hid_report_descriptor[] = {
    /* Standard keyboard report (Report ID 1) */
    0x05, 0x01,        /* Usage Page (Generic Desktop) */
    0x09, 0x06,        /* Usage (Keyboard) */
    0xA1, 0x01,        /* Collection (Application) */
    0x85, 0x01,        /*   Report ID (1) */

    /* Modifier keys (8 bits) */
    0x05, 0x07,        /*   Usage Page (Key Codes) */
    0x19, 0xE0,        /*   Usage Minimum (Left Control) */
    0x29, 0xE7,        /*   Usage Maximum (Right GUI) */
    0x15, 0x00,        /*   Logical Minimum (0) */
    0x25, 0x01,        /*   Logical Maximum (1) */
    0x75, 0x01,        /*   Report Size (1) */
    0x95, 0x08,        /*   Report Count (8) */
    0x81, 0x02,        /*   Input (Data, Variable, Absolute) */

    /* Reserved byte */
    0x75, 0x08,        /*   Report Size (8) */
    0x95, 0x01,        /*   Report Count (1) */
    0x81, 0x01,        /*   Input (Constant) */

    /* LED output report (5 bits) */
    0x05, 0x08,        /*   Usage Page (LEDs) */
    0x19, 0x01,        /*   Usage Minimum (Num Lock) */
    0x29, 0x05,        /*   Usage Maximum (Kana) */
    0x75, 0x01,        /*   Report Size (1) */
    0x95, 0x05,        /*   Report Count (5) */
    0x91, 0x02,        /*   Output (Data, Variable, Absolute) */
    0x75, 0x03,        /*   Report Size (3) */
    0x95, 0x01,        /*   Report Count (1) */
    0x91, 0x01,        /*   Output (Constant) */

    /* Key array (6 keys) */
    0x05, 0x07,        /*   Usage Page (Key Codes) */
    0x19, 0x00,        /*   Usage Minimum (0) */
    0x29, 0xFF,        /*   Usage Maximum (255) */
    0x15, 0x00,        /*   Logical Minimum (0) */
    0x26, 0xFF, 0x00,  /*   Logical Maximum (255) */
    0x75, 0x08,        /*   Report Size (8) */
    0x95, 0x06,        /*   Report Count (6) */
    0x81, 0x00,        /*   Input (Data, Array) */

    0xC0,              /* End Collection */

    /* Custom attestation output report (Report ID 2) */
    /* This allows the host to request attestation data */
    0x06, 0x00, 0xFF,  /* Usage Page (Vendor Defined 0xFF00) */
    0x09, 0x01,        /* Usage (Vendor Usage 1) */
    0xA1, 0x01,        /* Collection (Application) */
    0x85, 0x02,        /*   Report ID (2) */

    /* Attestation data (up to 64 bytes per report) */
    0x09, 0x02,        /*   Usage (Vendor Usage 2) */
    0x15, 0x00,        /*   Logical Minimum (0) */
    0x26, 0xFF, 0x00,  /*   Logical Maximum (255) */
    0x75, 0x08,        /*   Report Size (8) */
    0x95, 0x3F,        /*   Report Count (63) */
    0x81, 0x02,        /*   Input (Data, Variable, Absolute) */

    0xC0,              /* End Collection */
};

/* --------------------------------------------------------------------------
 * Data Types
 * -------------------------------------------------------------------------- */

/** Per-keystroke capacitive sensor data */
typedef struct {
    uint8_t  keycode;          /* USB HID keycode */
    uint8_t  row;              /* Matrix row */
    uint8_t  col;              /* Matrix column */
    uint32_t timestamp_ms;     /* Milliseconds since boot */
    uint16_t cap_approach;     /* Capacitance before key press (12-bit ADC) */
    uint16_t cap_touch;        /* Capacitance at full press (12-bit ADC) */
    uint16_t cap_release;      /* Capacitance at release */
    uint16_t press_duration_ms;/* Duration of physical key depression */
    bool     key_down;         /* true = press, false = release */
} kw_keystroke_event_t;

/** Fingerprint state */
typedef struct {
    bool     matched;             /* Did the last scan match an enrolled template? */
    uint8_t  confidence;          /* Match confidence 0-100 */
    uint64_t last_match_time;     /* Timestamp of last successful match */
    bool     sensor_present;      /* Is the fingerprint sensor responding? */
} kw_fingerprint_state_t;

/** USB HID keyboard report */
typedef struct __attribute__((packed)) {
    uint8_t report_id;
    uint8_t modifiers;
    uint8_t reserved;
    uint8_t keycodes[6];
} kw_keyboard_report_t;

/* --------------------------------------------------------------------------
 * Global State
 * -------------------------------------------------------------------------- */

/** Keystroke event buffer (circular) */
static kw_keystroke_event_t s_keystroke_buffer[KW_KEYSTROKE_BUFFER_SIZE];
static volatile uint32_t s_keystroke_write_idx = 0;
static volatile uint32_t s_keystroke_count = 0;
static SemaphoreHandle_t s_keystroke_mutex = NULL;

/** Current keyboard matrix state (debounced) */
static bool s_matrix_state[KW_MATRIX_ROWS][KW_MATRIX_COLS] = {{false}};
static bool s_matrix_prev[KW_MATRIX_ROWS][KW_MATRIX_COLS] = {{false}};

/** Debounce counters (in scan cycles) */
static uint8_t s_debounce[KW_MATRIX_ROWS][KW_MATRIX_COLS] = {{0}};
#define KW_DEBOUNCE_THRESHOLD  5  /* Number of consistent reads before accepting */

/** Current capacitive readings per key */
static uint16_t s_cap_values[KW_MATRIX_ROWS][KW_MATRIX_COLS] = {{0}};

/** Fingerprint state (updated by fingerprint task) */
static kw_fingerprint_state_t s_fp_state = {0};
static SemaphoreHandle_t s_fp_mutex = NULL;

/** USB HID ready flag */
static volatile bool s_usb_hid_ready = false;

/** Attestation in progress flag */
static volatile bool s_attest_in_progress = false;

/** Current cleartext buffer (reconstructed from keycodes) */
static char s_cleartext_buffer[8192];
static size_t s_cleartext_len = 0;

/** SHA-256 streaming context for capacitive sensor data */
static kw_sha256_ctx_t s_cap_hash_ctx;
static bool s_cap_hash_active = false;

/** Secure boot verification status */
static bool s_secure_boot_verified = false;

/** Task handles */
static TaskHandle_t s_matrix_scan_task = NULL;
static TaskHandle_t s_cap_sense_task = NULL;
static TaskHandle_t s_fingerprint_task = NULL;
static TaskHandle_t s_usb_task = NULL;

/* --------------------------------------------------------------------------
 * Forward Declarations
 * -------------------------------------------------------------------------- */

static void matrix_scan_task(void *arg);
static void capacitive_sense_task(void *arg);
static void fingerprint_task(void *arg);
static void usb_hid_task(void *arg);

static void handle_key_event(uint8_t row, uint8_t col, bool pressed);
static void handle_attest_key(void);
static uint8_t matrix_to_keycode(uint8_t row, uint8_t col);
static char keycode_to_char(uint8_t keycode, uint8_t modifiers);
static void send_hid_report(const kw_keyboard_report_t *report);
static void type_string_via_hid(const char *str);
static void set_attest_led(bool red, bool green);

/* --------------------------------------------------------------------------
 * Keycode Mapping
 * -------------------------------------------------------------------------- */

/**
 * Matrix position to USB HID keycode lookup table.
 * Based on standard ANSI TKL layout.
 *
 * TODO: Fill in complete keymap based on actual PCB matrix routing.
 * Values are USB HID Usage IDs from HID Usage Tables (Keyboard page 0x07).
 */
static const uint8_t kw_keymap[KW_MATRIX_ROWS][KW_MATRIX_COLS] = {
    /* Row 0: Esc, F1-F12, PrtSc, ScrLk, Pause, ATTEST */
    {0x29, 0x3A, 0x3B, 0x3C, 0x3D, 0x3E, 0x3F, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x00},
    /* Row 1: `, 1-9, 0, -, =, Backspace, Ins, Home, PgUp */
    {0x35, 0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x2D, 0x2E, 0x2A, 0x49, 0x4A, 0x4B},
    /* Row 2: Tab, Q-P, [, ], \, Del, End, PgDn */
    {0x2B, 0x14, 0x1A, 0x08, 0x15, 0x17, 0x1C, 0x18, 0x0C, 0x12, 0x13, 0x2F, 0x30, 0x31, 0x4C, 0x4D, 0x4E},
    /* Row 3: CapsLock, A-L, ;, ', Enter */
    {0x39, 0x04, 0x16, 0x07, 0x09, 0x0A, 0x0B, 0x0D, 0x0E, 0x0F, 0x33, 0x34, 0x28, 0x00, 0x00, 0x00, 0x00},
    /* Row 4: LShift, Z-M, comma, period, /, RShift, Up */
    {0xE1, 0x1D, 0x1B, 0x06, 0x19, 0x05, 0x11, 0x10, 0x36, 0x37, 0x38, 0xE5, 0x00, 0x00, 0x00, 0x52, 0x00},
    /* Row 5: LCtrl, LGUI, LAlt, Space, RAlt, RGUI, Menu, RCtrl, Left, Down, Right */
    {0xE0, 0xE3, 0xE2, 0x2C, 0x00, 0x00, 0xE6, 0xE7, 0x65, 0xE4, 0x00, 0x00, 0x00, 0x00, 0x50, 0x51, 0x4F},
};

/* --------------------------------------------------------------------------
 * USB HID Callbacks (TinyUSB)
 * -------------------------------------------------------------------------- */

/**
 * TinyUSB HID get report callback.
 * Called when host requests a report via GET_REPORT control transfer.
 */
uint16_t tud_hid_get_report_cb(uint8_t instance, uint8_t report_id,
                                hid_report_type_t report_type,
                                uint8_t *buffer, uint16_t reqlen)
{
    (void)instance;
    (void)report_id;
    (void)report_type;
    (void)buffer;
    (void)reqlen;
    return 0;
}

/**
 * TinyUSB HID set report callback.
 * Called when host sends a report (e.g., LED status from OS).
 */
void tud_hid_set_report_cb(uint8_t instance, uint8_t report_id,
                            hid_report_type_t report_type,
                            const uint8_t *buffer, uint16_t bufsize)
{
    (void)instance;

    if (report_type == HID_REPORT_TYPE_OUTPUT && report_id == 1) {
        /* LED output report from host (Num Lock, Caps Lock, etc.) */
        if (bufsize >= 1) {
            /* TODO: Drive keyboard LEDs based on buffer[0] bits */
            ESP_LOGD(TAG, "LED report: 0x%02x", buffer[0]);
        }
    }
}

/**
 * TinyUSB mount callback - device connected and configured.
 */
void tud_mount_cb(void)
{
    ESP_LOGI(TAG, "USB device mounted");
    s_usb_hid_ready = true;
}

/**
 * TinyUSB unmount callback - device disconnected.
 */
void tud_umount_cb(void)
{
    ESP_LOGI(TAG, "USB device unmounted");
    s_usb_hid_ready = false;
}

/* --------------------------------------------------------------------------
 * Matrix Scanning
 * -------------------------------------------------------------------------- */

/**
 * Initialize keyboard matrix GPIOs.
 * Rows are outputs (active low), columns are inputs (pull-up).
 */
static void matrix_init(void)
{
    /* Configure row GPIOs as outputs, default high */
    for (int r = 0; r < KW_MATRIX_ROWS; r++) {
        gpio_config_t row_cfg = {
            .pin_bit_mask = (1ULL << kw_row_gpios[r]),
            .mode = GPIO_MODE_OUTPUT,
            .pull_up_en = GPIO_PULLUP_DISABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        gpio_config(&row_cfg);
        gpio_set_level(kw_row_gpios[r], 1); /* Inactive (high) */
    }

    /* Configure column GPIOs as inputs with pull-up */
    for (int c = 0; c < KW_MATRIX_COLS; c++) {
        gpio_config_t col_cfg = {
            .pin_bit_mask = (1ULL << kw_col_gpios[c]),
            .mode = GPIO_MODE_INPUT,
            .pull_up_en = GPIO_PULLUP_ENABLE,
            .pull_down_en = GPIO_PULLDOWN_DISABLE,
            .intr_type = GPIO_INTR_DISABLE,
        };
        gpio_config(&col_cfg);
    }

    ESP_LOGI(TAG, "Keyboard matrix initialized (%dx%d)", KW_MATRIX_ROWS, KW_MATRIX_COLS);
}

/**
 * Scan the keyboard matrix once.
 * Drives each row low in sequence and reads column inputs.
 * Applies debouncing and generates key events on state changes.
 */
static void matrix_scan_once(void)
{
    bool raw_state[KW_MATRIX_ROWS][KW_MATRIX_COLS];

    for (int r = 0; r < KW_MATRIX_ROWS; r++) {
        /* Drive this row low */
        gpio_set_level(kw_row_gpios[r], 0);

        /* Small delay for signal to settle (~5 us) */
        esp_rom_delay_us(5);

        /* Read all columns */
        for (int c = 0; c < KW_MATRIX_COLS; c++) {
            /* Key pressed = column reads low (pulled down through switch) */
            raw_state[r][c] = (gpio_get_level(kw_col_gpios[c]) == 0);
        }

        /* Release row (drive high) */
        gpio_set_level(kw_row_gpios[r], 1);
    }

    /* Debounce and detect state changes */
    for (int r = 0; r < KW_MATRIX_ROWS; r++) {
        for (int c = 0; c < KW_MATRIX_COLS; c++) {
            if (raw_state[r][c] == s_matrix_state[r][c]) {
                /* Same as debounced state - reset counter */
                s_debounce[r][c] = 0;
            } else {
                /* Different from debounced state - increment counter */
                s_debounce[r][c]++;
                if (s_debounce[r][c] >= KW_DEBOUNCE_THRESHOLD) {
                    /* State has been consistent long enough - accept it */
                    s_matrix_prev[r][c] = s_matrix_state[r][c];
                    s_matrix_state[r][c] = raw_state[r][c];
                    s_debounce[r][c] = 0;

                    /* Generate key event */
                    handle_key_event(r, c, s_matrix_state[r][c]);
                }
            }
        }
    }
}

/**
 * Matrix scan task - runs continuously at ~1 kHz.
 */
static void matrix_scan_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();

    while (1) {
        matrix_scan_once();
        /* 1 ms period = 1 kHz scan rate */
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(1));
    }
}

/* --------------------------------------------------------------------------
 * Capacitive Touch Sensing
 * -------------------------------------------------------------------------- */

/**
 * Initialize per-key capacitive touch sensing.
 *
 * Uses ESP32-S3 touch sensor peripheral + analog multiplexers (CD74HC4067)
 * to measure capacitance at each key position.
 */
static void capacitive_init(void)
{
    /* Initialize touch pad peripheral */
    /* TODO: Configure ESP32-S3 touch sensor channels connected to multiplexer outputs */

    touch_pad_init();
    touch_pad_set_fsm_mode(TOUCH_FSM_MODE_SW); /* Software-triggered measurement */
    touch_pad_set_voltage(TOUCH_HVOLT_2V7, TOUCH_LVOLT_0V5, TOUCH_HVOLT_ATTEN_1V);

    /* Configure multiplexer control GPIOs */
    gpio_config_t mux_cfg = {
        .pin_bit_mask = (1ULL << KW_MUX_S0_GPIO) |
                        (1ULL << KW_MUX_S1_GPIO) |
                        (1ULL << KW_MUX_S2_GPIO) |
                        (1ULL << KW_MUX_S3_GPIO) |
                        (1ULL << KW_MUX_EN_GPIO),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&mux_cfg);

    /* Enable multiplexer (active low) */
    gpio_set_level(KW_MUX_EN_GPIO, 0);

    ESP_LOGI(TAG, "Capacitive touch sensing initialized");
}

/**
 * Select a multiplexer channel.
 *
 * @param channel  Channel number (0-15) on CD74HC4067.
 */
static void mux_select_channel(uint8_t channel)
{
    gpio_set_level(KW_MUX_S0_GPIO, (channel >> 0) & 1);
    gpio_set_level(KW_MUX_S1_GPIO, (channel >> 1) & 1);
    gpio_set_level(KW_MUX_S2_GPIO, (channel >> 2) & 1);
    gpio_set_level(KW_MUX_S3_GPIO, (channel >> 3) & 1);
}

/**
 * Read capacitive value for a specific key position.
 *
 * @param row  Matrix row.
 * @param col  Matrix column.
 * @return 12-bit capacitance value (higher = more capacitance = closer/more contact).
 */
static uint16_t read_cap_value(uint8_t row, uint8_t col)
{
    /*
     * TODO: Map (row, col) to the correct multiplexer and channel.
     *
     * With 6 multiplexers (CD74HC4067, 16 channels each) = 96 channels,
     * sufficient for a TKL keyboard (87 keys).
     *
     * Mapping example:
     *   mux_id = col / 16
     *   mux_channel = col % 16
     *   touch_pad_channel = row (each row connects to a different touch pad input)
     */

    uint8_t mux_id = col / 16;      /* Which multiplexer (0-5) */
    uint8_t mux_channel = col % 16;  /* Which channel on that mux */

    /* TODO: Select the correct multiplexer via enable lines */
    (void)mux_id;

    mux_select_channel(mux_channel);

    /* Small settling time after mux switch */
    esp_rom_delay_us(10);

    /* Read touch pad value */
    /* TODO: Map row to correct ESP32-S3 touch pad channel (TOUCH_PAD_NUM0-13) */
    uint32_t touch_value = 0;
    touch_pad_read_raw_data((touch_pad_t)row, &touch_value);

    return (uint16_t)(touch_value & 0x0FFF);
}

/**
 * Capacitive sensing task - reads cap values for all active keys.
 */
static void capacitive_sense_task(void *arg)
{
    (void)arg;
    TickType_t last_wake = xTaskGetTickCount();

    while (1) {
        /* Only sample keys that are currently being approached or pressed */
        for (int r = 0; r < KW_MATRIX_ROWS; r++) {
            for (int c = 0; c < KW_MATRIX_COLS; c++) {
                s_cap_values[r][c] = read_cap_value(r, c);
            }
        }

        /* 1 ms period for ~1 kHz per-key sampling when round-robining */
        vTaskDelayUntil(&last_wake, pdMS_TO_TICKS(1));
    }
}

/* --------------------------------------------------------------------------
 * Fingerprint Sensor Interface
 * -------------------------------------------------------------------------- */

/** SPI handle for FPC1025 communication */
static spi_device_handle_t s_fp_spi_handle = NULL;

/**
 * Initialize the FPC1025 fingerprint sensor over SPI.
 */
static void fingerprint_init(void)
{
    /* TODO: Assign actual SPI pins for FPC1025 */
    spi_bus_config_t bus_cfg = {
        .mosi_io_num = 35,     /* TODO: Actual MOSI pin */
        .miso_io_num = 37,     /* TODO: Actual MISO pin */
        .sclk_io_num = 36,     /* TODO: Actual SCLK pin */
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = 4096,
    };

    esp_err_t ret = spi_bus_initialize(SPI2_HOST, &bus_cfg, SPI_DMA_CH_AUTO);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "FPC1025 SPI bus init failed: %s", esp_err_to_name(ret));
        return;
    }

    spi_device_interface_config_t dev_cfg = {
        .clock_speed_hz = 8 * 1000 * 1000, /* 8 MHz SPI clock */
        .mode = 0,                           /* SPI mode 0 (CPOL=0, CPHA=0) */
        .spics_io_num = 34,                  /* TODO: Actual CS pin */
        .queue_size = 4,
    };

    ret = spi_bus_add_device(SPI2_HOST, &dev_cfg, &s_fp_spi_handle);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "FPC1025 SPI device add failed: %s", esp_err_to_name(ret));
        return;
    }

    /*
     * TODO: FPC1025 initialization sequence:
     * 1. Hardware reset (toggle RST pin)
     * 2. Read HW ID register (0xFC) - expect 0x021B for FPC1025
     * 3. Configure sensor parameters (gain, pixel drive, etc.)
     * 4. Load enrolled fingerprint template from secure element
     */

    /* Verify sensor presence by reading hardware ID */
    /* FPC1025 register read: send command byte, receive response */
    uint8_t tx_buf[2] = {0xFC, 0x00}; /* Read HW_ID register */
    uint8_t rx_buf[2] = {0};

    spi_transaction_t txn = {
        .length = 16,
        .tx_buffer = tx_buf,
        .rx_buffer = rx_buf,
    };

    ret = spi_device_transmit(s_fp_spi_handle, &txn);
    if (ret == ESP_OK) {
        uint16_t hw_id = ((uint16_t)rx_buf[0] << 8) | rx_buf[1];
        ESP_LOGI(TAG, "FPC1025 hardware ID: 0x%04x", hw_id);
        s_fp_state.sensor_present = true;
    } else {
        ESP_LOGW(TAG, "FPC1025 not responding - fingerprint disabled");
        s_fp_state.sensor_present = false;
    }
}

/**
 * Capture a fingerprint image and match against enrolled template.
 *
 * @return true if a matching fingerprint was detected.
 */
static bool fingerprint_capture_and_match(void)
{
    if (!s_fp_state.sensor_present || s_fp_spi_handle == NULL) {
        return false;
    }

    /*
     * TODO: Implement full FPC BEP (Biometric Evaluation Platform) flow:
     *
     * 1. Check finger detect signal (FPC1025 has hardware finger detect)
     *    - Read IRQ status register
     *    - If no finger present, return false
     *
     * 2. Capture image:
     *    - Send CAPTURE_IMAGE command
     *    - Wait for capture complete interrupt
     *    - Read image data from sensor (160x160 = 25,600 bytes)
     *
     * 3. Extract minutiae:
     *    - Run FPC BEP feature extraction on captured image
     *    - This produces a compact template (~500 bytes)
     *
     * 4. Match against enrolled template:
     *    - Read enrolled template from secure element (slot 8)
     *    - Run FPC BEP matching algorithm
     *    - Returns match score (0-100)
     *
     * 5. Apply threshold:
     *    - Match if score >= 40 (FAR < 1/50,000)
     *    - Store result
     *
     * NOTE: For PoC, this could use a simpler approach like
     * the FPC1025's built-in match-on-chip capability if available.
     */

    /* Placeholder: simulate fingerprint check */
    ESP_LOGD(TAG, "Fingerprint capture/match cycle (stub)");

    /* In real implementation, this would do SPI communication with FPC1025 */
    return false;
}

/**
 * Fingerprint polling task - periodically captures and matches.
 */
static void fingerprint_task(void *arg)
{
    (void)arg;

    while (1) {
        bool matched = fingerprint_capture_and_match();

        xSemaphoreTake(s_fp_mutex, portMAX_DELAY);
        if (matched) {
            s_fp_state.matched = true;
            s_fp_state.confidence = 85; /* TODO: Get actual confidence from BEP */
            s_fp_state.last_match_time = (uint64_t)(esp_timer_get_time() / 1000000ULL);
        }
        xSemaphoreGive(s_fp_mutex);

        vTaskDelay(pdMS_TO_TICKS(KW_FP_POLL_INTERVAL_MS));
    }
}

/* --------------------------------------------------------------------------
 * Key Event Handling
 * -------------------------------------------------------------------------- */

/**
 * Handle a key state change event.
 * Called from matrix_scan_once() when a key's debounced state changes.
 */
static void handle_key_event(uint8_t row, uint8_t col, bool pressed)
{
    /* Check if this is the ATTEST key */
    if (row == KW_ATTEST_KEY_ROW && col == KW_ATTEST_KEY_COL) {
        if (pressed) {
            handle_attest_key();
        }
        return;
    }

    uint8_t keycode = matrix_to_keycode(row, col);
    if (keycode == 0) return; /* Unmapped key position */

    /* Record keystroke event with capacitive data */
    kw_keystroke_event_t event = {
        .keycode = keycode,
        .row = row,
        .col = col,
        .timestamp_ms = (uint32_t)(esp_timer_get_time() / 1000ULL),
        .cap_approach = s_cap_values[row][col], /* Current cap reading */
        .cap_touch = pressed ? s_cap_values[row][col] : 0,
        .cap_release = pressed ? 0 : s_cap_values[row][col],
        .press_duration_ms = 0, /* Filled in on release */
        .key_down = pressed,
    };

    /* Store in circular buffer */
    xSemaphoreTake(s_keystroke_mutex, portMAX_DELAY);

    s_keystroke_buffer[s_keystroke_write_idx] = event;
    s_keystroke_write_idx = (s_keystroke_write_idx + 1) % KW_KEYSTROKE_BUFFER_SIZE;
    if (s_keystroke_count < KW_KEYSTROKE_BUFFER_SIZE) {
        s_keystroke_count++;
    }

    /* Update capacitive sensor hash (streaming) */
    if (s_cap_hash_active) {
        kw_sha256_update(&s_cap_hash_ctx, (const uint8_t *)&event, sizeof(event));
    }

    /* Append to cleartext buffer (only on key press, not release) */
    if (pressed && s_cleartext_len < sizeof(s_cleartext_buffer) - 1) {
        /* TODO: Track modifier state for accurate character conversion */
        char ch = keycode_to_char(keycode, 0);
        if (ch != '\0') {
            s_cleartext_buffer[s_cleartext_len++] = ch;
            s_cleartext_buffer[s_cleartext_len] = '\0';
        }
    }

    xSemaphoreGive(s_keystroke_mutex);

    /* Send USB HID report */
    if (s_usb_hid_ready) {
        /* Build 6KRO report */
        kw_keyboard_report_t report = {
            .report_id = 1,
            .modifiers = 0,
            .reserved = 0,
            .keycodes = {0},
        };

        /* Check if this is a modifier key (0xE0-0xE7) */
        if (keycode >= 0xE0 && keycode <= 0xE7) {
            /* Modifier keys are tracked as bits in the modifier byte */
            /* TODO: Track modifier state across multiple key events */
            if (pressed) {
                report.modifiers |= (1 << (keycode - 0xE0));
            }
        } else if (pressed) {
            report.keycodes[0] = keycode;
        }
        /* On release, send empty report (all zeros except report ID) */

        send_hid_report(&report);
    }
}

/**
 * Look up USB HID keycode for a matrix position.
 */
static uint8_t matrix_to_keycode(uint8_t row, uint8_t col)
{
    if (row >= KW_MATRIX_ROWS || col >= KW_MATRIX_COLS) return 0;
    return kw_keymap[row][col];
}

/**
 * Convert a USB HID keycode to a printable ASCII character.
 * Simplified - handles basic alphanumeric keys only.
 *
 * @param keycode    USB HID keycode.
 * @param modifiers  Current modifier key state.
 * @return ASCII character, or '\0' if not printable.
 */
static char keycode_to_char(uint8_t keycode, uint8_t modifiers)
{
    bool shift = (modifiers & 0x22) != 0; /* Left or right shift */

    /* Letters a-z (keycodes 0x04-0x1D) */
    if (keycode >= 0x04 && keycode <= 0x1D) {
        char ch = 'a' + (keycode - 0x04);
        return shift ? (ch - 'a' + 'A') : ch;
    }

    /* Numbers 1-9, 0 (keycodes 0x1E-0x27) */
    if (keycode >= 0x1E && keycode <= 0x26) {
        if (shift) {
            const char shifted[] = "!@#$%^&*(";
            return shifted[keycode - 0x1E];
        }
        return '1' + (keycode - 0x1E);
    }
    if (keycode == 0x27) return shift ? ')' : '0';

    /* Special characters */
    switch (keycode) {
        case 0x28: return '\n';       /* Enter */
        case 0x2A: return '\b';       /* Backspace */
        case 0x2B: return '\t';       /* Tab */
        case 0x2C: return ' ';        /* Space */
        case 0x2D: return shift ? '_' : '-';
        case 0x2E: return shift ? '+' : '=';
        case 0x2F: return shift ? '{' : '[';
        case 0x30: return shift ? '}' : ']';
        case 0x31: return shift ? '|' : '\\';
        case 0x33: return shift ? ':' : ';';
        case 0x34: return shift ? '"' : '\'';
        case 0x35: return shift ? '~' : '`';
        case 0x36: return shift ? '<' : ',';
        case 0x37: return shift ? '>' : '.';
        case 0x38: return shift ? '?' : '/';
        default: return '\0';
    }
}

/* --------------------------------------------------------------------------
 * USB HID Output
 * -------------------------------------------------------------------------- */

/**
 * Send a keyboard HID report via USB.
 */
static void send_hid_report(const kw_keyboard_report_t *report)
{
    if (!s_usb_hid_ready) return;

    /* TinyUSB HID keyboard report (without explicit report ID for boot protocol) */
    tud_hid_keyboard_report(report->report_id,
                            report->modifiers,
                            report->keycodes);

    /* Wait for report to be sent */
    while (!tud_hid_ready()) {
        vTaskDelay(1);
    }
}

/**
 * Type a string character-by-character via USB HID.
 * Used to output the attestation block.
 *
 * This simulates typing by sending HID key press/release for each character.
 */
static void type_string_via_hid(const char *str)
{
    if (str == NULL || !s_usb_hid_ready) return;

    kw_keyboard_report_t report = {
        .report_id = 1,
        .modifiers = 0,
        .reserved = 0,
        .keycodes = {0},
    };

    for (const char *p = str; *p != '\0'; p++) {
        char ch = *p;
        uint8_t keycode = 0;
        uint8_t modifier = 0;

        /* Map ASCII to USB HID keycode + modifier */
        if (ch >= 'a' && ch <= 'z') {
            keycode = 0x04 + (ch - 'a');
        } else if (ch >= 'A' && ch <= 'Z') {
            keycode = 0x04 + (ch - 'A');
            modifier = 0x02; /* Left Shift */
        } else if (ch >= '1' && ch <= '9') {
            keycode = 0x1E + (ch - '1');
        } else if (ch == '0') {
            keycode = 0x27;
        } else if (ch == '\n') {
            keycode = 0x28;
        } else if (ch == ' ') {
            keycode = 0x2C;
        } else if (ch == '-') {
            keycode = 0x2D;
        } else if (ch == '=') {
            keycode = 0x2E;
        } else if (ch == '+') {
            keycode = 0x2E; modifier = 0x02;
        } else if (ch == '/') {
            keycode = 0x38;
        } else {
            /* For other characters, skip or use a lookup table */
            /* TODO: Complete character-to-keycode mapping */
            continue;
        }

        /* Key press */
        report.modifiers = modifier;
        report.keycodes[0] = keycode;
        send_hid_report(&report);
        vTaskDelay(pdMS_TO_TICKS(5)); /* Small inter-key delay */

        /* Key release */
        report.modifiers = 0;
        report.keycodes[0] = 0;
        send_hid_report(&report);
        vTaskDelay(pdMS_TO_TICKS(2));
    }
}

/* --------------------------------------------------------------------------
 * ATTEST Key Handler
 * -------------------------------------------------------------------------- */

/**
 * Set the ATTEST key LED color.
 * Red = error/busy, Green = success, Both = yellow/processing, Neither = off.
 */
static void set_attest_led(bool red, bool green)
{
    gpio_set_level(KW_ATTEST_LED_RED_GPIO, red ? 1 : 0);
    gpio_set_level(KW_ATTEST_LED_GREEN_GPIO, green ? 1 : 0);
}

/**
 * Initialize ATTEST key LED GPIOs.
 */
static void attest_led_init(void)
{
    gpio_config_t led_cfg = {
        .pin_bit_mask = (1ULL << KW_ATTEST_LED_RED_GPIO) |
                        (1ULL << KW_ATTEST_LED_GREEN_GPIO),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&led_cfg);
    set_attest_led(false, false);
}

/**
 * Handle press of the dedicated ATTEST key.
 *
 * This is the core attestation flow:
 * 1. Freeze keystroke buffer
 * 2. Finalize capacitive sensor data hash
 * 3. Read device identity and counter from secure element
 * 4. Build attestation payload
 * 5. Sign with secure element
 * 6. Output attestation block via USB HID
 * 7. Clear buffer
 */
static void handle_attest_key(void)
{
    if (s_attest_in_progress) {
        ESP_LOGW(TAG, "Attestation already in progress");
        return;
    }

    s_attest_in_progress = true;
    set_attest_led(true, true); /* Yellow = processing */

    ESP_LOGI(TAG, "=== ATTESTATION STARTED ===");

    /* Step 1: Freeze the keystroke buffer */
    xSemaphoreTake(s_keystroke_mutex, portMAX_DELAY);

    char *cleartext = strdup(s_cleartext_buffer);
    uint32_t keystroke_count = s_keystroke_count;

    xSemaphoreGive(s_keystroke_mutex);

    if (cleartext == NULL || strlen(cleartext) == 0) {
        ESP_LOGW(TAG, "No text to attest");
        set_attest_led(true, false); /* Red = error */
        vTaskDelay(pdMS_TO_TICKS(1000));
        set_attest_led(false, false);
        s_attest_in_progress = false;
        free(cleartext);
        return;
    }

    ESP_LOGI(TAG, "Attesting %zu chars from %lu keystrokes",
             strlen(cleartext), (unsigned long)keystroke_count);

    /* Step 2: Finalize capacitive sensor data hash */
    uint8_t sensor_data_hash[KW_HASH_SIZE] = {0};
    if (s_cap_hash_active) {
        kw_sha256_finish(&s_cap_hash_ctx, sensor_data_hash);
        s_cap_hash_active = false;
    }

    /* Step 3: Read device identity and increment counter */
    uint8_t device_serial[KW_SERIAL_SIZE];
    esp_err_t ret = kw_crypto_get_serial(device_serial);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to read device serial");
        set_attest_led(true, false);
        vTaskDelay(pdMS_TO_TICKS(2000));
        set_attest_led(false, false);
        s_attest_in_progress = false;
        free(cleartext);
        return;
    }

    uint32_t counter_value = 0;
    ret = kw_crypto_counter_increment(&counter_value);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to increment counter");
        set_attest_led(true, false);
        vTaskDelay(pdMS_TO_TICKS(2000));
        set_attest_led(false, false);
        s_attest_in_progress = false;
        free(cleartext);
        return;
    }

    /* Step 4: Read fingerprint state */
    xSemaphoreTake(s_fp_mutex, portMAX_DELAY);
    bool fp_matched = s_fp_state.matched;
    uint8_t fp_confidence = s_fp_state.confidence;
    uint64_t fp_last_seen = s_fp_state.last_match_time;
    xSemaphoreGive(s_fp_mutex);

    /* Step 5: Build attestation payload */
    kw_attestation_payload_t payload = {
        .version = KW_ATTESTATION_VERSION,
        .counter = counter_value,
        .timestamp = (uint64_t)(esp_timer_get_time() / 1000000ULL),
        .cleartext = cleartext,
        .fingerprint_matched = fp_matched,
        .fingerprint_confidence = fp_confidence,
        .fingerprint_last_seen = fp_last_seen,
        .secure_boot_verified = s_secure_boot_verified,
    };
    memcpy(payload.device_serial, device_serial, KW_SERIAL_SIZE);
    memcpy(payload.sensor_data_hash, sensor_data_hash, KW_HASH_SIZE);
    strncpy(payload.firmware_version, KW_FIRMWARE_VERSION,
            sizeof(payload.firmware_version) - 1);

    /* Step 6: Sign the attestation */
    kw_signed_attestation_t attestation;
    ret = kw_attestation_sign(&payload, &attestation);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Attestation signing failed: %s", esp_err_to_name(ret));
        set_attest_led(true, false); /* Red = error */
        vTaskDelay(pdMS_TO_TICKS(2000));
        set_attest_led(false, false);
        s_attest_in_progress = false;
        free(cleartext);
        return;
    }

    /* Step 7: Serialize to output format */
    char output[4096];
    size_t output_len = 0;
    ret = kw_attestation_serialize(&attestation, output, sizeof(output), &output_len);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Attestation serialization failed");
        set_attest_led(true, false);
        vTaskDelay(pdMS_TO_TICKS(2000));
        set_attest_led(false, false);
        s_attest_in_progress = false;
        free(cleartext);
        return;
    }

    /* Step 8: Type the attestation block via USB HID */
    ESP_LOGI(TAG, "Outputting attestation (%zu bytes) via USB HID", output_len);
    type_string_via_hid("\n");
    type_string_via_hid(output);

    /* Step 9: Clear buffers and restart hash context */
    xSemaphoreTake(s_keystroke_mutex, portMAX_DELAY);
    s_keystroke_count = 0;
    s_keystroke_write_idx = 0;
    s_cleartext_len = 0;
    s_cleartext_buffer[0] = '\0';

    /* Restart capacitive hash for next session */
    kw_sha256_init(&s_cap_hash_ctx);
    s_cap_hash_active = true;
    xSemaphoreGive(s_keystroke_mutex);

    /* Reset fingerprint state for next session */
    xSemaphoreTake(s_fp_mutex, portMAX_DELAY);
    s_fp_state.matched = false;
    s_fp_state.confidence = 0;
    xSemaphoreGive(s_fp_mutex);

    /* Success indication */
    set_attest_led(false, true); /* Green = success */
    ESP_LOGI(TAG, "=== ATTESTATION COMPLETE (counter=%lu) ===",
             (unsigned long)counter_value);

    vTaskDelay(pdMS_TO_TICKS(2000));
    set_attest_led(false, false);

    free(cleartext);
    s_attest_in_progress = false;
}

/* --------------------------------------------------------------------------
 * USB Task
 * -------------------------------------------------------------------------- */

/**
 * USB device task - handles TinyUSB event processing.
 */
static void usb_hid_task(void *arg)
{
    (void)arg;

    while (1) {
        tud_task(); /* TinyUSB device task (processes USB events) */
        vTaskDelay(1); /* Yield to other tasks */
    }
}

/* --------------------------------------------------------------------------
 * Secure Boot Verification
 * -------------------------------------------------------------------------- */

/**
 * Check secure boot status on startup.
 * Reads the ESP32-S3 eFuse to verify secure boot is enabled and
 * the running firmware was authenticated by the ROM bootloader.
 */
static void check_secure_boot(void)
{
#ifdef CONFIG_SECURE_BOOT_V2_ENABLED
    if (esp_secure_boot_enabled()) {
        ESP_LOGI(TAG, "Secure boot V2 is ENABLED");
        s_secure_boot_verified = true;
    } else {
        ESP_LOGW(TAG, "Secure boot V2 is configured but NOT enabled in eFuse");
        s_secure_boot_verified = false;
    }
#else
    ESP_LOGW(TAG, "Secure boot is NOT configured in firmware build");
    s_secure_boot_verified = false;
#endif

    /* TODO: Additionally verify flash encryption status */
    /* esp_flash_encryption_enabled() */
}

/* --------------------------------------------------------------------------
 * Main Application Entry Point
 * -------------------------------------------------------------------------- */

void app_main(void)
{
    ESP_LOGI(TAG, "====================================");
    ESP_LOGI(TAG, "  KeyWitness Attestation Keyboard");
    ESP_LOGI(TAG, "  Firmware v%s", KW_FIRMWARE_VERSION);
    ESP_LOGI(TAG, "====================================");

    /* Initialize NVS (required by some ESP-IDF components) */
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS flash erasing and reinitializing");
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    /* Check secure boot status */
    check_secure_boot();

    /* Initialize crypto subsystem (ATECC608B) */
    ret = kw_crypto_init();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "CRITICAL: Crypto initialization failed!");
        ESP_LOGE(TAG, "Attestation will not be available.");
        /* Continue running as a basic keyboard even if crypto fails */
    } else {
        /* Print device identity */
        kw_device_identity_t identity;
        if (kw_crypto_get_device_identity(&identity) == ESP_OK) {
            ESP_LOGI(TAG, "Device serial: %02x%02x%02x%02x%02x%02x%02x%02x%02x",
                     identity.serial[0], identity.serial[1], identity.serial[2],
                     identity.serial[3], identity.serial[4], identity.serial[5],
                     identity.serial[6], identity.serial[7], identity.serial[8]);
        }
    }

    /* Initialize USB HID */
    ESP_LOGI(TAG, "Initializing USB HID");
    const tinyusb_config_t tusb_cfg = {
        .device_descriptor = NULL,       /* Use default from sdkconfig */
        .string_descriptor = NULL,
        .external_phy = false,
        .configuration_descriptor = NULL,
    };
    ESP_ERROR_CHECK(tinyusb_driver_install(&tusb_cfg));

    /* Initialize hardware subsystems */
    ESP_LOGI(TAG, "Initializing keyboard matrix");
    matrix_init();

    ESP_LOGI(TAG, "Initializing capacitive sensing");
    capacitive_init();

    ESP_LOGI(TAG, "Initializing fingerprint sensor");
    fingerprint_init();

    ESP_LOGI(TAG, "Initializing ATTEST key LED");
    attest_led_init();

    /* Create synchronization primitives */
    s_keystroke_mutex = xSemaphoreCreateMutex();
    s_fp_mutex = xSemaphoreCreateMutex();
    configASSERT(s_keystroke_mutex != NULL);
    configASSERT(s_fp_mutex != NULL);

    /* Initialize streaming hash for capacitive data */
    kw_sha256_init(&s_cap_hash_ctx);
    s_cap_hash_active = true;

    /* Start tasks */
    ESP_LOGI(TAG, "Starting tasks");

    /* USB task - highest priority for responsive HID */
    xTaskCreatePinnedToCore(usb_hid_task, "usb_hid",
                            4096, NULL, 5, &s_usb_task, 0);

    /* Matrix scan - high priority, time-critical */
    xTaskCreatePinnedToCore(matrix_scan_task, "matrix_scan",
                            4096, NULL, 4, &s_matrix_scan_task, 1);

    /* Capacitive sensing - high priority, time-critical */
    xTaskCreatePinnedToCore(capacitive_sense_task, "cap_sense",
                            4096, NULL, 4, &s_cap_sense_task, 1);

    /* Fingerprint polling - lower priority, periodic */
    xTaskCreatePinnedToCore(fingerprint_task, "fingerprint",
                            8192, NULL, 2, &s_fingerprint_task, 0);

    ESP_LOGI(TAG, "KeyWitness keyboard ready");
    ESP_LOGI(TAG, "Press ATTEST key to sign typed text");

    /* Main task can now idle or handle other housekeeping */
    while (1) {
        vTaskDelay(pdMS_TO_TICKS(10000));

        /* Periodic health check logging */
        ESP_LOGI(TAG, "Status: keystrokes=%lu, cleartext_len=%zu, fp_matched=%d, usb=%d",
                 (unsigned long)s_keystroke_count, s_cleartext_len,
                 s_fp_state.matched, s_usb_hid_ready);
    }
}
