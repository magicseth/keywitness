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

// MARK: - Encrypted Inner Payload

/// The inner payload that gets AES-GCM encrypted.
/// Contains cleartext and keystroke timings so they are never exposed in plaintext.
struct EncryptedInnerPayload: Codable {
    let cleartext: String
    let keystrokeTimings: [KeystrokeTiming]
}

// MARK: - Attestation Payload

/// The full attestation payload matching the KeyWitness protocol.
/// keystrokeTimings are inside encryptedCleartext, never in the outer envelope.
struct Attestation: Codable {
    let version: String
    let appAttestToken: String?
    let cleartextHash: String
    let encryptedCleartext: String
    let deviceId: String
    let faceIdVerified: Bool
    let timestamp: String
    let keystrokeBiometricsHash: String
    let signature: String
    let publicKey: String
}

// MARK: - Attestation Builder

final class AttestationBuilder {

    static let protocolVersion = "keywitness-v2"

    // MARK: - Public API

    /// Creates a full attestation for the given cleartext and keystroke events.
    /// Returns a tuple of (block: PEM-style attestation text, encryptionKey: base64url AES key).
    static func createAttestation(cleartext: String,
                                  keystrokeEvents: [KeystrokeEvent],
                                  faceIdVerified: Bool,
                                  appAttestToken: String? = nil) throws -> (block: String, encryptionKey: String) {

        let deviceId = deviceIdentifier()
        let timestamp = iso8601Timestamp()
        let biometricsHash = hashKeystrokeBiometrics(keystrokeEvents)
        let publicKey = try CryptoEngine.publicKeyBase64URL()
        let timings = buildKeystrokeTimings(keystrokeEvents)

        // Generate AES-256 key for client-side encryption
        let aesKey = CryptoEngine.generateAESKey()

        // Compute cleartext hash
        let cleartextHash = CryptoEngine.sha256Base64URL(Data(cleartext.utf8))

        // Build inner payload containing cleartext + keystroke timings
        let innerPayload = EncryptedInnerPayload(cleartext: cleartext, keystrokeTimings: timings)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let innerJSON = try encoder.encode(innerPayload)

        // Encrypt inner payload (cleartext + timings) with AES-GCM
        let encryptedData = try CryptoEngine.encryptAESGCM(plaintext: innerJSON, key: aesKey)
        let encryptedCleartext = CryptoEngine.base64URLEncode(encryptedData)

        // Build the canonical signing payload — includes encryptedCleartext so
        // the ciphertext cannot be swapped without invalidating the signature
        let signingPayload = canonicalSigningPayload(
            version: protocolVersion,
            appAttestToken: appAttestToken,
            cleartextHash: cleartextHash,
            encryptedCleartext: encryptedCleartext,
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
            appAttestToken: appAttestToken,
            cleartextHash: cleartextHash,
            encryptedCleartext: encryptedCleartext,
            deviceId: deviceId,
            faceIdVerified: faceIdVerified,
            timestamp: timestamp,
            keystrokeBiometricsHash: biometricsHash,
            signature: signature,
            publicKey: publicKey
        )

        let block = try formatAttestationBlock(attestation)
        let encryptionKey = CryptoEngine.aesKeyBase64URL(aesKey)
        return (block: block, encryptionKey: encryptionKey)
    }

    // MARK: - Canonical Signing Payload

    /// Builds the canonical JSON signing payload with sorted keys and no whitespace.
    /// This is the exact byte string that gets signed.
    static func canonicalSigningPayload(version: String,
                                        appAttestToken: String?,
                                        cleartextHash: String,
                                        encryptedCleartext: String,
                                        deviceId: String,
                                        faceIdVerified: Bool,
                                        timestamp: String,
                                        keystrokeBiometricsHash: String) -> String {
        // Manually construct sorted-key JSON to guarantee deterministic output.
        // Keys in alphabetical order: appAttestToken (if present), cleartextHash, deviceId,
        // encryptedCleartext, faceIdVerified, keystrokeBiometricsHash, timestamp, version
        var parts: [String] = []

        if let token = appAttestToken {
            parts.append("\"appAttestToken\":\"\(jsonEscape(token))\"")
        }
        parts.append("\"\(jsonEscape("cleartextHash"))\":\"\(jsonEscape(cleartextHash))\"")
        parts.append("\"\(jsonEscape("deviceId"))\":\"\(jsonEscape(deviceId))\"")
        parts.append("\"\(jsonEscape("encryptedCleartext"))\":\"\(jsonEscape(encryptedCleartext))\"")
        parts.append("\"faceIdVerified\":\(faceIdVerified)")
        parts.append("\"\(jsonEscape("keystrokeBiometricsHash"))\":\"\(jsonEscape(keystrokeBiometricsHash))\"")
        parts.append("\"\(jsonEscape("timestamp"))\":\"\(jsonEscape(timestamp))\"")
        parts.append("\"\(jsonEscape("version"))\":\"\(jsonEscape(version))\"")

        return "{" + parts.joined(separator: ",") + "}"
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
