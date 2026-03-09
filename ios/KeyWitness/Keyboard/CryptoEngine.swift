import Foundation
import CryptoKit

/// CryptoEngine handles Ed25519 key management and signing using CryptoKit
/// with keys stored in the iOS Keychain (shared via access group) so that
/// compromise of the app container alone does not leak the signing identity.
final class CryptoEngine {

    // MARK: - Constants

    private static let keychainService = "io.keywitness.signing"
    private static let keychainAccount = "ed25519-device-key"
    private static let keychainAccessGroup = "group.io.keywitness"

    // MARK: - Key Management

    /// Retrieves the existing signing key from the Keychain, or creates and stores a new one.
    static func getOrCreateSigningKey() throws -> Curve25519.Signing.PrivateKey {
        if let existing = try loadKeyFromKeychain() {
            return existing
        }
        let newKey = Curve25519.Signing.PrivateKey()
        try storeKeyInKeychain(newKey)
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

    // MARK: - Registration Challenge

    /// Signs a key registration challenge to prove ownership of the private key.
    /// Challenge format: "keywitness:register:<publicKey>:<name>"
    static func signRegistrationChallenge(name: String) throws -> (signature: String, publicKey: String) {
        let pubKey = try publicKeyBase64URL()
        let challenge = "keywitness:register:\(pubKey):\(name)"
        guard let data = challenge.data(using: .utf8) else {
            throw CryptoEngineError.encryptionFailed
        }
        let signature = try signBase64URL(data)
        return (signature: signature, publicKey: pubKey)
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

    // MARK: - AES-256-GCM Encryption

    /// Generates a new AES-256 symmetric key.
    static func generateAESKey() -> SymmetricKey {
        return SymmetricKey(size: .bits256)
    }

    /// Encrypts plaintext with AES-GCM, returning combined representation (nonce 12 bytes || ciphertext || tag 16 bytes).
    static func encryptAESGCM(plaintext: Data, key: SymmetricKey) throws -> Data {
        let sealedBox = try AES.GCM.seal(plaintext, using: key)
        guard let combined = sealedBox.combined else {
            throw CryptoEngineError.encryptionFailed
        }
        return combined
    }

    /// Converts an AES symmetric key to a base64url-encoded string (no padding).
    static func aesKeyBase64URL(_ key: SymmetricKey) -> String {
        return key.withUnsafeBytes { bytes in
            base64URLEncode(Data(bytes))
        }
    }

    // MARK: - Base64URL Encoding

    /// Encodes data to base64url (RFC 4648 Section 5) with no padding.
    static func base64URLEncode(_ data: Data) -> String {
        return data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: - Keychain Storage

    private static func loadKeyFromKeychain() throws -> Curve25519.Signing.PrivateKey? {
        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrService as String:      keychainService,
            kSecAttrAccount as String:      keychainAccount,
            kSecAttrAccessGroup as String:  keychainAccessGroup,
            kSecReturnData as String:       true,
            kSecMatchLimit as String:       kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        if status == errSecItemNotFound {
            return nil
        }
        guard status == errSecSuccess, let data = result as? Data else {
            throw CryptoEngineError.keychainReadFailed(status)
        }
        return try Curve25519.Signing.PrivateKey(rawRepresentation: data)
    }

    private static func storeKeyInKeychain(_ key: Curve25519.Signing.PrivateKey) throws {
        let data = key.rawRepresentation

        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrService as String:      keychainService,
            kSecAttrAccount as String:      keychainAccount,
            kSecAttrAccessGroup as String:  keychainAccessGroup,
            kSecValueData as String:        data,
            kSecAttrAccessible as String:   kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]

        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw CryptoEngineError.keychainWriteFailed(status)
        }
    }
}

// MARK: - Errors

enum CryptoEngineError: Error, LocalizedError {
    case keychainReadFailed(OSStatus)
    case keychainWriteFailed(OSStatus)
    case encryptionFailed

    var errorDescription: String? {
        switch self {
        case .keychainReadFailed(let status):
            return "Keychain read failed (status \(status))."
        case .keychainWriteFailed(let status):
            return "Keychain write failed (status \(status))."
        case .encryptionFailed:
            return "AES-GCM encryption failed to produce combined output."
        }
    }
}
