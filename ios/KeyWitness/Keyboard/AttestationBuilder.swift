import Foundation
import UIKit

// MARK: - Keystroke Event

/// Captures biometric data for a single keystroke.
struct KeystrokeEvent: Codable {
    let key: String
    let touchDownTime: TimeInterval
    let touchUpTime: TimeInterval
    let x: CGFloat
    let y: CGFloat
    let force: CGFloat
    let majorRadius: CGFloat

    /// Duration the key was held down, in milliseconds.
    var dwellTime: TimeInterval {
        return (touchUpTime - touchDownTime) * 1000.0
    }
}

// MARK: - Attestation Payload

/// The full attestation payload matching the KeyWitness protocol.
struct Attestation: Codable {
    let version: String
    let cleartext: String
    let deviceId: String
    let timestamp: String
    let keystrokeBiometricsHash: String
    let signature: String
    let publicKey: String

    enum CodingKeys: String, CodingKey {
        case version
        case cleartext
        case deviceId          = "deviceId"
        case timestamp
        case keystrokeBiometricsHash = "keystrokeBiometricsHash"
        case signature
        case publicKey         = "publicKey"
    }
}

// MARK: - Attestation Builder

final class AttestationBuilder {

    static let protocolVersion = "keywitness-v1"

    // MARK: - Public API

    /// Creates a full attestation for the given cleartext and keystroke events.
    /// Returns the PEM-style attestation text block ready for insertion.
    static func createAttestation(cleartext: String,
                                  keystrokeEvents: [KeystrokeEvent]) throws -> String {

        let deviceId = deviceIdentifier()
        let timestamp = iso8601Timestamp()
        let biometricsHash = hashKeystrokeBiometrics(keystrokeEvents)
        let publicKey = try CryptoEngine.publicKeyBase64URL()

        // Build the canonical signing payload
        let signingPayload = canonicalSigningPayload(
            version: protocolVersion,
            cleartext: cleartext,
            deviceId: deviceId,
            timestamp: timestamp,
            keystrokeBiometricsHash: biometricsHash
        )

        guard let payloadData = signingPayload.data(using: .utf8) else {
            throw AttestationError.encodingFailed
        }

        let signature = try CryptoEngine.signBase64URL(payloadData)

        let attestation = Attestation(
            version: protocolVersion,
            cleartext: cleartext,
            deviceId: deviceId,
            timestamp: timestamp,
            keystrokeBiometricsHash: biometricsHash,
            signature: signature,
            publicKey: publicKey
        )

        return try formatAttestationBlock(attestation)
    }

    // MARK: - Canonical Signing Payload

    /// Builds the canonical JSON signing payload with sorted keys and no whitespace.
    /// This is the exact byte string that gets signed.
    static func canonicalSigningPayload(version: String,
                                        cleartext: String,
                                        deviceId: String,
                                        timestamp: String,
                                        keystrokeBiometricsHash: String) -> String {
        // Manually construct sorted-key JSON to guarantee deterministic output.
        // Keys in alphabetical order: cleartext, deviceId, keystrokeBiometricsHash, timestamp, version
        let pairs: [(String, String)] = [
            ("cleartext", cleartext),
            ("deviceId", deviceId),
            ("keystrokeBiometricsHash", keystrokeBiometricsHash),
            ("timestamp", timestamp),
            ("version", version)
        ]

        let entries = pairs.map { key, value in
            "\"\(jsonEscape(key))\":\"\(jsonEscape(value))\""
        }

        return "{\(entries.joined(separator: ","))}"
    }

    // MARK: - Keystroke Biometrics Hash

    /// Serializes keystroke events to JSON, then computes SHA-256, returning base64url.
    static func hashKeystrokeBiometrics(_ events: [KeystrokeEvent]) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        guard let jsonData = try? encoder.encode(events) else {
            // If encoding fails, hash an empty array representation
            return CryptoEngine.sha256Base64URL(Data("[]".utf8))
        }

        return CryptoEngine.sha256Base64URL(jsonData)
    }

    // MARK: - Formatting

    /// Formats the attestation as a PEM-style text block with base64url-encoded JSON.
    static func formatAttestationBlock(_ attestation: Attestation) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        let jsonData = try encoder.encode(attestation)
        let base64url = CryptoEngine.base64URLEncode(jsonData)

        return """
        -----BEGIN KEYWITNESS ATTESTATION-----
        \(base64url)
        -----END KEYWITNESS ATTESTATION-----
        """
    }

    // MARK: - Helpers

    /// Returns the device identifier (identifierForVendor UUID string).
    static func deviceIdentifier() -> String {
        return UIDevice.current.identifierForVendor?.uuidString ?? "unknown-device"
    }

    /// Returns the current time as an ISO 8601 string with milliseconds.
    static func iso8601Timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }

    /// Escapes a string for safe inclusion in a JSON value.
    private static func jsonEscape(_ string: String) -> String {
        var result = ""
        for char in string {
            switch char {
            case "\"":  result += "\\\""
            case "\\":  result += "\\\\"
            case "\n":  result += "\\n"
            case "\r":  result += "\\r"
            case "\t":  result += "\\t"
            default:    result.append(char)
            }
        }
        return result
    }
}

// MARK: - Errors

enum AttestationError: Error, LocalizedError {
    case encodingFailed

    var errorDescription: String? {
        switch self {
        case .encodingFailed:
            return "Failed to encode attestation payload"
        }
    }
}
