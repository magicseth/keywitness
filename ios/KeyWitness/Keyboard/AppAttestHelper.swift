import Foundation
import DeviceCheck
import CryptoKit

/// App Attest helper for the keyboard extension.
/// Manages its OWN App Attest key (separate from the main app) and generates
/// per-request assertions. Performs the one-time attestation flow on first use.
final class AppAttestHelper {

    static let shared = AppAttestHelper()

    private let service = DCAppAttestService.shared
    private let defaults = UserDefaults(suiteName: "group.io.keywitness")

    // Use separate keys from the main app since App Attest keys are process-bound
    private static let keyIdKey = "keyboardAppAttestKeyId"
    private static let attestedKey = "keyboardAppAttestCompleted"
    private static let attestationObjectKey = "keyboardAppAttestAttestationObject"

    /// Whether App Attest is available and the key has been attested.
    var isAvailable: Bool {
        let supported = service.isSupported
        let hasKeyId = defaults?.string(forKey: Self.keyIdKey) != nil
        let completed = defaults?.bool(forKey: Self.attestedKey) == true
        NSLog("[AppAttestHelper] isAvailable: supported=%d hasKeyId=%d completed=%d", supported ? 1 : 0, hasKeyId ? 1 : 0, completed ? 1 : 0)
        return supported && hasKeyId && completed
    }

    var keyId: String? {
        defaults?.string(forKey: Self.keyIdKey)
    }

    /// The base64url-encoded CBOR attestation object from Apple (contains X.509 cert chain).
    var attestationObject: String? {
        defaults?.string(forKey: Self.attestationObjectKey)
    }

    private var isAttested: Bool {
        defaults?.bool(forKey: Self.attestedKey) ?? false
    }

    /// Clears the attested state so the keyboard will re-attest on next use.
    func resetState() {
        NSLog("[AppAttestHelper] Resetting attested state — key is invalid")
        defaults?.removeObject(forKey: Self.keyIdKey)
        defaults?.removeObject(forKey: Self.attestedKey)
        defaults?.removeObject(forKey: Self.attestationObjectKey)
    }

    // MARK: - Setup (runs in keyboard extension process)

    /// Runs the full App Attest setup if not already complete.
    /// Called automatically before first assertion if needed.
    func setupIfNeeded() async throws {
        guard service.isSupported else {
            NSLog("[AppAttestHelper] App Attest not supported")
            throw AppAttestHelperError.notSupported
        }
        guard !isAttested else {
            NSLog("[AppAttestHelper] Already attested, keyId: %@", keyId ?? "nil")
            return
        }

        // Step 1: Generate key
        let currentKeyId: String
        if let existing = keyId {
            NSLog("[AppAttestHelper] Step 1: Reusing key %@", existing)
            currentKeyId = existing
        } else {
            NSLog("[AppAttestHelper] Step 1: Generating new key...")
            currentKeyId = try await service.generateKey()
            defaults?.set(currentKeyId, forKey: Self.keyIdKey)
            NSLog("[AppAttestHelper] Step 1: Generated key %@", currentKeyId)
        }

        // Step 2: Get challenge from server
        NSLog("[AppAttestHelper] Step 2: Fetching challenge...")
        let challenge = try await fetchChallenge()
        NSLog("[AppAttestHelper] Step 2: Got challenge")

        // Step 3: Attest with Apple
        NSLog("[AppAttestHelper] Step 3: Attesting with Apple...")
        let attestationObject: Data
        do {
            let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
            attestationObject = try await service.attestKey(currentKeyId, clientDataHash: clientDataHash)
            NSLog("[AppAttestHelper] Step 3: Apple attestation succeeded (%d bytes)", attestationObject.count)
        } catch {
            NSLog("[AppAttestHelper] Step 3 FAILED: %@ — clearing burned key", error.localizedDescription)
            defaults?.removeObject(forKey: Self.keyIdKey)
            throw error
        }

        // Step 4: Store attestation object for independent verification
        defaults?.set(CryptoEngine.base64URLEncode(attestationObject), forKey: Self.attestationObjectKey)
        NSLog("[AppAttestHelper] Step 4: Stored attestation object (%d bytes)", attestationObject.count)

        // Step 5: Verify with server
        NSLog("[AppAttestHelper] Step 5: Verifying with server...")
        let ed25519PublicKey = try CryptoEngine.publicKeyBase64URL()
        try await verifyWithServer(
            keyId: currentKeyId,
            attestation: attestationObject,
            challenge: challenge,
            publicKey: ed25519PublicKey
        )
        NSLog("[AppAttestHelper] Step 4: Server verification succeeded")

        // Step 5: Mark complete
        defaults?.set(true, forKey: Self.attestedKey)
        NSLog("[AppAttestHelper] Step 5: SETUP COMPLETE")
    }

    // MARK: - Assertion

    /// Generates an App Attest assertion for the given client data.
    func generateAssertion(for clientData: Data) async throws -> Data {
        // Auto-setup if needed
        if !isAttested {
            try await setupIfNeeded()
        }

        guard let keyId = keyId else {
            throw AppAttestHelperError.notAttested
        }
        NSLog("[AppAttestHelper] generateAssertion: keyId=%@, %d bytes clientData", keyId, clientData.count)
        let clientDataHash = Data(SHA256.hash(data: clientData))
        let assertion = try await service.generateAssertion(keyId, clientDataHash: clientDataHash)
        NSLog("[AppAttestHelper] generateAssertion: success (%d bytes)", assertion.count)
        return assertion
    }

    // MARK: - Server Communication

    private func fetchChallenge() async throws -> String {
        let url = URL(string: "https://keywitness.io/api/app-attest/challenge")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            NSLog("[AppAttestHelper] fetchChallenge: bad response")
            throw AppAttestHelperError.challengeFailed
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let challenge = json["challenge"] as? String else {
            throw AppAttestHelperError.challengeFailed
        }
        return challenge
    }

    private func verifyWithServer(keyId: String, attestation: Data, challenge: String, publicKey: String) async throws {
        let url = URL(string: "https://keywitness.io/api/app-attest/verify")!
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
            let body = String(data: data, encoding: .utf8) ?? ""
            NSLog("[AppAttestHelper] verifyWithServer FAILED: %@", body)
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                msg = error
            }
            throw AppAttestHelperError.serverFailed(msg)
        }
    }
}

enum AppAttestHelperError: Error, LocalizedError {
    case notAttested
    case notSupported
    case challengeFailed
    case serverFailed(String)

    var errorDescription: String? {
        switch self {
        case .notAttested:
            return "App Attest key has not been attested yet."
        case .notSupported:
            return "App Attest is not supported on this device."
        case .challengeFailed:
            return "Failed to fetch App Attest challenge."
        case .serverFailed(let msg):
            return "App Attest server verification failed: \(msg)"
        }
    }
}
