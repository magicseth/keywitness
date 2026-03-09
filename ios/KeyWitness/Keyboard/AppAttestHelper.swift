import Foundation
import DeviceCheck
import CryptoKit

/// Lightweight App Attest helper for the keyboard extension.
/// Reads the attested key ID from the shared app group and generates
/// per-request assertions. Does NOT perform the one-time attestation flow.
final class AppAttestHelper {

    static let shared = AppAttestHelper()

    private let service = DCAppAttestService.shared
    private let defaults = UserDefaults(suiteName: "group.io.keywitness")

    /// Whether App Attest is available and the key has been attested.
    var isAvailable: Bool {
        return service.isSupported
            && defaults?.string(forKey: "appAttestKeyId") != nil
            && defaults?.bool(forKey: "appAttestCompleted") == true
    }

    var keyId: String? {
        defaults?.string(forKey: "appAttestKeyId")
    }

    /// Generates an App Attest assertion for the given client data.
    /// The clientData should be a deterministic string identifying this attestation
    /// (e.g., "cleartextHash:deviceId:timestamp").
    func generateAssertion(for clientData: Data) async throws -> Data {
        guard let keyId = keyId else {
            throw AppAttestHelperError.notAttested
        }
        let clientDataHash = Data(SHA256.hash(data: clientData))
        return try await service.generateAssertion(keyId, clientDataHash: clientDataHash)
    }
}

enum AppAttestHelperError: Error, LocalizedError {
    case notAttested

    var errorDescription: String? {
        switch self {
        case .notAttested:
            return "App Attest key has not been attested yet."
        }
    }
}
