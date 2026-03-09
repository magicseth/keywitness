import Foundation
import DeviceCheck
import CryptoKit
import os.log

private let log = Logger(subsystem: "io.keywitness.app", category: "AppAttest")

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
        NSLog("[AppAttest] setupIfNeeded — isSupported=%d isAttested=%d keyId=%@", isSupported ? 1 : 0, isAttested ? 1 : 0, keyId ?? "nil")

        guard isSupported else {
            NSLog("[AppAttest] NOT SUPPORTED on this device")
            return
        }
        guard !isAttested else {
            NSLog("[AppAttest] Already attested, skipping")
            return
        }

        // Step 1: Generate key if we don't have one
        let currentKeyId: String
        if let existing = keyId {
            NSLog("[AppAttest] Step 1: Reusing existing key %@", existing)
            currentKeyId = existing
        } else {
            NSLog("[AppAttest] Step 1: Generating new key...")
            do {
                currentKeyId = try await service.generateKey()
                defaults?.set(currentKeyId, forKey: Self.keyIdKey)
                NSLog("[AppAttest] Step 1: Generated key %@", currentKeyId)
            } catch {
                NSLog("[AppAttest] Step 1 FAILED: %@", error.localizedDescription)
                throw error
            }
        }

        // Step 2: Get a challenge from the server
        NSLog("[AppAttest] Step 2: Fetching challenge...")
        let challenge: String
        do {
            challenge = try await fetchChallenge()
            NSLog("[AppAttest] Step 2: Got challenge (length %d)", challenge.count)
        } catch {
            NSLog("[AppAttest] Step 2 FAILED: %@", error.localizedDescription)
            throw error
        }

        // Step 3: Attest the key with Apple
        NSLog("[AppAttest] Step 3: Attesting key with Apple...")
        let attestationObject: Data
        do {
            let clientDataHash = Data(SHA256.hash(data: Data(challenge.utf8)))
            attestationObject = try await service.attestKey(currentKeyId, clientDataHash: clientDataHash)
            NSLog("[AppAttest] Step 3: Apple attestation succeeded (%d bytes)", attestationObject.count)
        } catch {
            NSLog("[AppAttest] Step 3 FAILED: %@ — clearing burned key", error.localizedDescription)
            defaults?.removeObject(forKey: Self.keyIdKey)
            throw error
        }

        // Step 4: Send attestation to server for verification
        NSLog("[AppAttest] Step 4: Verifying with server...")
        do {
            let ed25519PublicKey = try CryptoEngine.publicKeyBase64URL()
            // Proof-of-possession: sign the challenge with the Ed25519 key
            let publicKeySignature = try CryptoEngine.signBase64URL(Data(challenge.utf8))
            NSLog("[AppAttest] Step 4: Ed25519 key: %@..., PoP signature generated", String(ed25519PublicKey.prefix(20)))
            try await verifyAttestationWithServer(
                keyId: currentKeyId,
                attestation: attestationObject,
                challenge: challenge,
                publicKey: ed25519PublicKey,
                publicKeySignature: publicKeySignature
            )
            NSLog("[AppAttest] Step 4: Server verification succeeded!")
        } catch {
            NSLog("[AppAttest] Step 4 FAILED: %@", error.localizedDescription)
            throw error
        }

        // Step 5: Mark as complete
        defaults?.set(true, forKey: Self.attestedKey)
        NSLog("[AppAttest] Step 5: SETUP COMPLETE! isAttested=%d", isAttested ? 1 : 0)
    }

    // MARK: - Server Communication

    private func fetchChallenge() async throws -> String {
        let url = URL(string: "https://keywitness.io/api/app-attest/challenge")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            NSLog("[AppAttest] fetchChallenge: not an HTTP response")
            throw AppAttestError.challengeFetchFailed
        }
        NSLog("[AppAttest] fetchChallenge: HTTP %d", httpResponse.statusCode)
        guard httpResponse.statusCode == 200 else {
            let body = String(data: data, encoding: .utf8) ?? "(non-utf8)"
            NSLog("[AppAttest] fetchChallenge: bad status %d, body: %@", httpResponse.statusCode, body)
            throw AppAttestError.challengeFetchFailed
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let challenge = json["challenge"] as? String else {
            log.error("fetchChallenge: could not parse challenge from response")
            throw AppAttestError.challengeFetchFailed
        }
        return challenge
    }

    private func verifyAttestationWithServer(keyId: String, attestation: Data, challenge: String, publicKey: String, publicKeySignature: String) async throws {
        let url = URL(string: "https://keywitness.io/api/app-attest/verify")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = [
            "keyId": keyId,
            "attestation": CryptoEngine.base64URLEncode(attestation),
            "challenge": challenge,
            "publicKey": publicKey,
            "publicKeySignature": publicKeySignature,
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)
        NSLog("[AppAttest] verifyWithServer: sending %d bytes", request.httpBody?.count ?? 0)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw AppAttestError.serverVerificationFailed("Not an HTTP response")
        }
        NSLog("[AppAttest] verifyWithServer: HTTP %d", httpResponse.statusCode)
        guard httpResponse.statusCode == 200 else {
            var msg = "Server rejected attestation (HTTP \(httpResponse.statusCode))"
            let body = String(data: data, encoding: .utf8) ?? "(non-utf8)"
            NSLog("[AppAttest] verifyWithServer FAILED: %@", body)
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let error = json["error"] as? String {
                msg = error
            }
            throw AppAttestError.serverVerificationFailed(msg)
        }
    }

    // MARK: - Assertion Generation

    /// Generates an App Attest assertion for the given client data.
    /// Must have completed setup first (isAttested == true).
    /// If the stored key is invalid (e.g. after reinstall), resets and re-attests automatically.
    func generateAssertion(for clientData: Data) async throws -> Data {
        if !isAttested {
            try await setupIfNeeded()
        }
        guard let currentKeyId = keyId else {
            throw AppAttestError.notAttested
        }
        let clientDataHash = Data(SHA256.hash(data: clientData))
        do {
            let assertion = try await service.generateAssertion(currentKeyId, clientDataHash: clientDataHash)
            NSLog("[AppAttest] generateAssertion: success (%d bytes) for keyId=%@", assertion.count, String(currentKeyId.prefix(8)))
            return assertion
        } catch {
            let nsError = error as NSError
            // DCError.invalidKey = 3 — key was invalidated (reinstall, etc.)
            if nsError.domain == "com.apple.devicecheck.error" && nsError.code == 3 {
                NSLog("[AppAttest] Key invalid (code 3) — resetting and re-attesting...")
                resetIfNeeded()
                try await setupIfNeeded()
                guard let newKeyId = keyId else {
                    throw AppAttestError.notAttested
                }
                let assertion = try await service.generateAssertion(newKeyId, clientDataHash: clientDataHash)
                NSLog("[AppAttest] generateAssertion after re-attest: success (%d bytes) for keyId=%@", assertion.count, String(newKeyId.prefix(8)))
                return assertion
            }
            throw error
        }
    }

    // MARK: - Session Token (shared with keyboard extension)

    private static let sessionAssertionKey = "appAttestSessionAssertion"
    private static let sessionKeyIdKey = "appAttestSessionKeyId"
    private static let sessionClientDataKey = "appAttestSessionClientData"

    /// The session challenge string, bound to this device's Ed25519 key.
    /// Format: keywitness:session:{publicKey}
    /// No expiry — the token proves "this Ed25519 key lives on a real Apple device"
    /// and that fact doesn't change. Naturally invalidated by app reinstall (App Attest
    /// key burned) or new Ed25519 key (embedded key won't match signatures).
    private func sessionChallenge() throws -> String {
        let pubKey = try CryptoEngine.publicKeyBase64URL()
        return "keywitness:session:\(pubKey)"
    }

    /// Whether a valid session token exists.
    var hasValidSession: Bool {
        defaults?.string(forKey: Self.sessionAssertionKey) != nil
    }

    /// Generates a session assertion and stores it in shared UserDefaults
    /// for the keyboard extension to read. Only needs to run once — the token
    /// is permanent until the App Attest key is invalidated.
    func refreshSessionToken() async {
        guard isSupported else {
            NSLog("[AppAttest] Session: not supported, skipping")
            return
        }

        if hasValidSession {
            NSLog("[AppAttest] Session: valid token already exists")
            return
        }

        NSLog("[AppAttest] Session: generating token...")
        do {
            let clientDataString = try sessionChallenge()
            let clientData = clientDataString.data(using: .utf8)!
            let assertion = try await generateAssertion(for: clientData)

            defaults?.set(CryptoEngine.base64URLEncode(assertion), forKey: Self.sessionAssertionKey)
            defaults?.set(keyId, forKey: Self.sessionKeyIdKey)
            defaults?.set(clientDataString, forKey: Self.sessionClientDataKey)

            NSLog("[AppAttest] Session: token stored permanently")
        } catch {
            NSLog("[AppAttest] Session: failed to generate token: %@", error.localizedDescription)
        }
    }

    // MARK: - Reset (for key invalidation after reinstall)

    func resetIfNeeded() {
        log.warning("Resetting App Attest state")
        defaults?.removeObject(forKey: Self.keyIdKey)
        defaults?.removeObject(forKey: Self.attestedKey)
        defaults?.removeObject(forKey: Self.sessionAssertionKey)
        defaults?.removeObject(forKey: Self.sessionKeyIdKey)
        defaults?.removeObject(forKey: Self.sessionClientDataKey)
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
