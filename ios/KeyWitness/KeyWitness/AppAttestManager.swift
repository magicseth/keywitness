import Foundation
import DeviceCheck
import CryptoKit

/// Manages Apple App Attest integration for the main app.
/// Handles one-time key generation + attestation with Apple's servers,
/// then stores the key ID in the shared app group for the keyboard extension.
final class AppAttestManager {

    static let shared = AppAttestManager()

    private let service = DCAppAttestService.shared
    private let defaults = UserDefaults(suiteName: "group.io.keywitness")

    // MARK: - Shared UserDefaults keys

    private static let keyIdKey = "appAttestKeyId"
    private static let attestedKey = "appAttestCompleted"

    // MARK: - Public Properties

    var isSupported: Bool { service.isSupported }

    var keyId: String? {
        defaults?.string(forKey: Self.keyIdKey)
    }

    var isAttested: Bool {
        defaults?.bool(forKey: Self.attestedKey) ?? false
    }

    // MARK: - Setup

    /// Runs the full App Attest setup if not already complete.
    /// Safe to call multiple times — returns immediately if already attested.
    func setupIfNeeded() async throws {
        guard isSupported else { return }
        guard !isAttested else { return }

        // Step 1: Generate key if we don't have one
        let currentKeyId: String
        if let existing = keyId {
            currentKeyId = existing
        } else {
            currentKeyId = try await service.generateKey()
            defaults?.set(currentKeyId, forKey: Self.keyIdKey)
        }

        // Step 2: Get a challenge from the server
        let challenge = try await fetchChallenge()

        // Step 3: Attest the key with Apple
        let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
        let attestationObject = try await service.attestKey(currentKeyId, clientDataHash: clientDataHash)

        // Step 4: Send attestation to server for verification
        let ed25519PublicKey = try CryptoEngine.publicKeyBase64URL()
        try await verifyAttestationWithServer(
            keyId: currentKeyId,
            attestation: attestationObject,
            challenge: challenge,
            publicKey: ed25519PublicKey
        )

        // Step 5: Mark as complete
        defaults?.set(true, forKey: Self.attestedKey)
    }

    // MARK: - Server Communication

    private func fetchChallenge() async throws -> String {
        let url = URL(string: "https://www.keywitness.io/api/app-attest/challenge")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AppAttestError.challengeFetchFailed
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let challenge = json["challenge"] as? String else {
            throw AppAttestError.challengeFetchFailed
        }
        return challenge
    }

    private func verifyAttestationWithServer(keyId: String, attestation: Data, challenge: String, publicKey: String) async throws {
        let url = URL(string: "https://www.keywitness.io/api/app-attest/verify")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = [
            "keyId": keyId,
            "attestation": CryptoEngine.base64URLEncode(attestation),
            "challenge": challenge,
            "publicKey": publicKey,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            var msg = "Server rejected attestation"
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                msg = error
            }
            throw AppAttestError.serverVerificationFailed(msg)
        }
    }

    // MARK: - Reset (for key invalidation after reinstall)

    func resetIfNeeded() {
        // If we have a key ID but attestation fails, the key may be invalid
        defaults?.removeObject(forKey: Self.keyIdKey)
        defaults?.removeObject(forKey: Self.attestedKey)
    }
}

// MARK: - Errors

enum AppAttestError: Error, LocalizedError {
    case challengeFetchFailed
    case serverVerificationFailed(String)
    case notAttested

    var errorDescription: String? {
        switch self {
        case .challengeFetchFailed:
            return "Failed to fetch App Attest challenge from server."
        case .serverVerificationFailed(let msg):
            return "App Attest verification failed: \(msg)"
        case .notAttested:
            return "App Attest key has not been attested yet."
        }
    }
}
