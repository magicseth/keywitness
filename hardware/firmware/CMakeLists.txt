# KeyWitness Hardware Keyboard Firmware
# ESP-IDF CMake build file
#
# Build instructions:
#   1. Install ESP-IDF v5.1+ (https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/get-started/)
#   2. Set target: idf.py set-target esp32s3
#   3. Configure: idf.py menuconfig
#   4. Build: idf.py build
#   5. Flash: idf.py -p /dev/ttyUSB0 flash monitor

# Minimum CMake version required by ESP-IDF
cmake_minimum_required(VERSION 3.16)

# Include ESP-IDF build system
include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Project name
project(keywitness_keyboard)

# --------------------------------------------------------------------------
# Component registration (for ESP-IDF component-based build)
# --------------------------------------------------------------------------
# This file serves as both the top-level CMakeLists.txt and can be adapted
# as a component CMakeLists.txt. For component use, uncomment the section
# below and place firmware sources in a "main" component directory.

# For a single-component project structure:
# firmware/
#   CMakeLists.txt          (this file)
#   main/
#     CMakeLists.txt         (component cmake)
#     main.c
#     crypto.c
#     crypto.h
#     Kconfig.projbuild      (menuconfig options)

# --------------------------------------------------------------------------
# If this is the main component CMakeLists.txt:
# --------------------------------------------------------------------------
# idf_component_register(
#     SRCS
#         "main.c"
#         "crypto.c"
#     INCLUDE_DIRS
#         "."
#     REQUIRES
#         driver          # GPIO, I2C, SPI, touch sensor drivers
#         esp_timer       # High-resolution timer
#         tinyusb         # USB HID via TinyUSB (ESP-IDF component)
#         mbedtls         # SHA-256, base64
#         nvs_flash       # Non-volatile storage
#         esp_event       # Event loop
#         freertos        # FreeRTOS (implicit, but explicit for clarity)
# )

# --------------------------------------------------------------------------
# Sdkconfig defaults for KeyWitness keyboard
# --------------------------------------------------------------------------
# These can also be set via: idf.py menuconfig
#
# CONFIG_ESP32S3_DEFAULT_CPU_FREQ_240=y
# CONFIG_FREERTOS_HZ=1000
#
# # USB Configuration
# CONFIG_TINYUSB_HID_ENABLED=y
# CONFIG_TINYUSB_CDC_ENABLED=y
# CONFIG_TINYUSB_DESC_MANUFACTURER_STRING="KeyWitness"
# CONFIG_TINYUSB_DESC_PRODUCT_STRING="KeyWitness Attestation Keyboard"
# CONFIG_TINYUSB_DESC_SERIAL_STRING=""
# CONFIG_TINYUSB_DESC_BCD_DEVICE=0x0100
#
# # Secure Boot
# CONFIG_SECURE_BOOT=y
# CONFIG_SECURE_BOOT_V2_ENABLED=y
# CONFIG_SECURE_FLASH_ENC_ENABLED=y
# CONFIG_SECURE_FLASH_ENCRYPTION_MODE_RELEASE=y
#
# # mbedTLS (for SHA-256)
# CONFIG_MBEDTLS_HARDWARE_SHA=y
#
# # Touch sensor
# CONFIG_ESP32_TOUCH_SENSOR_ENABLE=y
#
# # Partition table (custom for OTA support)
# CONFIG_PARTITION_TABLE_CUSTOM=y
# CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
