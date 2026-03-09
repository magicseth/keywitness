import Foundation
import CryptoKit

/// CryptoEngine handles Ed25519 key management and signing using CryptoKit
/// with keys stored in a shared App Group container accessible to both
/// the main app and the keyboard extension.
final class CryptoEngine {

    // MARK: - Constants

    private static let appGroupID = "group.io.keywitness"
    private static let keyFileName = "signing-key.bin"

    // MARK: - Key Management

    /// Retrieves the existing signing key from the shared container, or creates and stores a new one.
    static func getOrCreateSigningKey() throws -> Curve25519.Signing.PrivateKey {
        if let existing = try loadKeyFromSharedContainer() {
            return existing
        }
        let newKey = Curve25519.Signing.PrivateKey()
        try storeKeyInSharedContainer(newKey)
        return newKey
    }

    /// Returns the public key as a base64url-encoded string (no padding).
    static func publicKeyBase64URL() throws -> String {
        let key = try getOrCreateSigningKey()
        return base64URLEncode(key.publicKey.rawRepresentation)
    }

    // MARK: - Signing

    /// Signs the given data with the device signing key and returns the signature bytes.
    static func sign(_ data: Data) throws -> Data {
        let key = try getOrCreateSigningKey()
        return try key.signature(for: data)
    }

    /// Signs the given data and returns the signature as a base64url-encoded string.
    static func signBase64URL(_ data: Data) throws -> String {
        let signature = try sign(data)
        return base64URLEncode(signature)
    }

    // MARK: - Hashing

    /// Computes the SHA-256 hash of the given data and returns it as raw bytes.
    static func sha256(_ data: Data) -> Data {
        let digest = SHA256.hash(data: data)
        return Data(digest)
    }

    /// Computes the SHA-256 hash and returns it as a base64url-encoded string.
    static func sha256Base64URL(_ data: Data) -> String {
        return base64URLEncode(sha256(data))
    }

    // MARK: - Base64URL Encoding

    /// Encodes data to base64url (RFC 4648 Section 5) with no padding.
    static func base64URLEncode(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - Shared Container Storage

    private static func sharedContainerURL() throws -> URL {
        guard let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID) else {
            throw CryptoEngineError.appGroupNotAvailable
        }
        return url
    }

    private static func keyFileURL() throws -> URL {
        return try sharedContainerURL().appendingPathComponent(keyFileName)
    }

    private static func loadKeyFromSharedContainer() throws -> Curve25519.Signing.PrivateKey? {
        let fileURL = try keyFileURL()
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            return nil
        }
        let data = try Data(contentsOf: fileURL)
        return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
    }

    private static func storeKeyInSharedContainer(_ key: Curve25519.Signing.PrivateKey) throws {
        let fileURL = try keyFileURL()
        let data = key.rawRepresentation
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUnlessOpen])
    }
}

// MARK: - Errors

enum CryptoEngineError: Error, LocalizedError {
    case appGroupNotAvailable

    var errorDescription: String? {
        switch self {
        case .appGroupNotAvailable:
            return "App Group container not available. Check entitlements."
        }
    }
}
