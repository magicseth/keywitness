import Foundation
import CoreBluetooth

/// BLE GATT service and characteristic UUIDs for KeyWitness attestation.
enum BLEConstants {
    /// Protocol version. Increment on breaking changes.
    static let protocolVersion: UInt8 = 1

    // MARK: - Service UUID

    static let serviceUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF1234567890")

    // MARK: - Characteristic UUIDs

    /// Session handshake: web writes init, phone notifies with session ack.
    static let sessionUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF1234560001")

    /// Keystroke events: web writes without response for speed.
    static let keystrokeUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF1234560002")

    /// Attestation request: web writes cleartext + hash, triggers Face ID on phone.
    static let attestRequestUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF1234560003")

    /// Attestation result: phone notifies with chunked signed VC.
    static let attestResultUUID = CBUUID(string: "A1B2C3D4-E5F6-7890-ABCD-EF1234560004")

    // MARK: - Message Types

    enum MessageType: UInt8 {
        case keystrokeEvent   = 0x01
        case sessionInit      = 0x10
        case sessionAck       = 0x11
        case attestRequest    = 0x20
        case attestResult     = 0x30
    }

    // MARK: - Attestation Status

    enum AttestStatus: UInt8 {
        case success       = 0x00
        case userCancelled = 0x01
        case error         = 0x02
    }

    /// BLE advertising local name.
    static let localName = "KeyWitness"

    /// Max chunk payload size (conservative, works with default MTU).
    static let defaultChunkSize = 180
}
