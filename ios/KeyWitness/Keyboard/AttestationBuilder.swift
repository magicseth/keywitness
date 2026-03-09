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

// MARK: - Keystroke Timing

/// A single keystroke's timing and biometric data, relative to session start.
struct KeystrokeTiming: Codable {
    let key: String
    let downAt: TimeInterval  // ms relative to first keyDown
    let upAt: TimeInterval    // ms relative to first keyDown
    let x: CGFloat            // touch x within key
    let y: CGFloat            // touch y within key
    let force: CGFloat        // 3D Touch / haptic force
    let radius: CGFloat       // finger contact radius
}

// MARK: - Attestation Payload

/// The full attestation payload matching the KeyWitness protocol.
struct Attestation: Codable {
    let version: String
    let cleartext: String
    let deviceId: String
    let faceIdVerified: Bool
    let timestamp: String
    let keystrokeBiometricsHash: String
    let keystrokeTimings: [KeystrokeTiming]
    let signature: String
    let publicKey: String
}

// MARK: - Attestation Builder

final class AttestationBuilder {

    static let protocolVersion = "keywitness-v1"

    // MARK: - Public API

    /// Creates a full attestation for the given cleartext and keystroke events.
    /// Returns the PEM-style attestation text block ready for insertion.
    static func createAttestation(cleartext: String,
                                  keystrokeEvents: [KeystrokeEvent],
                                  faceIdVerified: Bool) throws -> String {

        let deviceId = deviceIdentifier()
        let timestamp = iso8601Timestamp()
        let biometricsHash = hashKeystrokeBiometrics(keystrokeEvents)
        let publicKey = try CryptoEngine.publicKeyBase64URL()
        let timings = buildKeystrokeTimings(keystrokeEvents)

        // Build the canonical signing payload (does NOT include keystrokeTimings)
        let signingPayload = canonicalSigningPayload(
            version: protocolVersion,
            cleartext: cleartext,
            deviceId: deviceId,
            faceIdVerified: faceIdVerified,
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
            faceIdVerified: faceIdVerified,
            timestamp: timestamp,
            keystrokeBiometricsHash: biometricsHash,
            keystrokeTimings: timings,
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
                                        faceIdVerified: Bool,
                                        timestamp: String,
                                        keystrokeBiometricsHash: String) -> String {
        // Manually construct sorted-key JSON to guarantee deterministic output.
        // Keys in alphabetical order: cleartext, deviceId, faceIdVerified, keystrokeBiometricsHash, timestamp, version
        return "{"
            + "\"\(jsonEscape("cleartext"))\":\"\(jsonEscape(cleartext))\","
            + "\"\(jsonEscape("deviceId"))\":\"\(jsonEscape(deviceId))\","
            + "\"faceIdVerified\":\(faceIdVerified),"
            + "\"\(jsonEscape("keystrokeBiometricsHash"))\":\"\(jsonEscape(keystrokeBiometricsHash))\","
            + "\"\(jsonEscape("timestamp"))\":\"\(jsonEscape(timestamp))\","
            + "\"\(jsonEscape("version"))\":\"\(jsonEscape(version))\""
            + "}"
    }

    // MARK: - Keystroke Timings

    /// Builds relative keystroke timings from raw events.
    /// All times are in milliseconds relative to the first keyDown (which becomes 0ms).
    static func buildKeystrokeTimings(_ events: [KeystrokeEvent]) -> [KeystrokeTiming] {
        guard let firstDownTime = events.first?.touchDownTime else {
            return []
        }

        return events.map { event in
            KeystrokeTiming(
                key: event.key,
                downAt: (event.touchDownTime - firstDownTime) * 1000.0,
                upAt: (event.touchUpTime - firstDownTime) * 1000.0,
                x: round(event.x * 100) / 100,
                y: round(event.y * 100) / 100,
                force: round(event.force * 1000) / 1000,
                radius: round(event.majorRadius * 100) / 100
            )
        }
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
