import Foundation
import CryptoKit

/// Builds W3C Verifiable Credential 2.0 attestations using eddsa-jcs-2022.
///
/// This replaces the hand-rolled v2 format in AttestationBuilder with a
/// standards-compliant VC that any VC verifier can parse.
final class VCBuilder {

    static let vcContext = "https://www.w3.org/ns/credentials/v2"
    static let kwContext = "https://keywitness.io/ns/v1"

    // MARK: - Public API

    /// Creates a v3 VC attestation.
    /// Returns (block: PEM-armored VC, encryptionKey: base64url AES key).
    static func createVC(cleartext: String,
                         keystrokeEvents: [KeystrokeEvent],
                         faceIdVerified: Bool,
                         appAttestKeyId: String? = nil,
                         appAttestAssertion: String? = nil,
                         appAttestClientData: String? = nil) throws -> (block: String, encryptionKey: String) {

        let deviceId = AttestationBuilder.deviceIdentifier()
        let timestamp = AttestationBuilder.iso8601Timestamp()
        let biometricsHash = AttestationBuilder.hashKeystrokeBiometrics(keystrokeEvents)
        let publicKeyData = try CryptoEngine.getOrCreateSigningKey().publicKey.rawRepresentation
        let publicKeyB64 = CryptoEngine.base64URLEncode(publicKeyData)
        let timings = AttestationBuilder.buildKeystrokeTimings(keystrokeEvents)

        // Generate AES-256 key for client-side encryption
        let aesKey = CryptoEngine.generateAESKey()

        // Compute cleartext hash
        let cleartextHash = CryptoEngine.sha256Base64URL(Data(cleartext.utf8))

        // Build and encrypt inner payload
        let innerPayload = EncryptedInnerPayload(cleartext: cleartext, keystrokeTimings: timings)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let innerJSON = try encoder.encode(innerPayload)
        let encryptedData = try CryptoEngine.encryptAESGCM(plaintext: innerJSON, key: aesKey)
        let encryptedCleartext = CryptoEngine.base64URLEncode(encryptedData)

        // Build did:key identifier
        let issuerDID = DIDKey.ed25519ToDIDKey(publicKeyData)
        let verificationMethod = DIDKey.verificationMethodId(for: issuerDID)

        // Get app version
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"

        // Build credential subject
        var credentialSubject: [String: Any] = [
            "type": "HumanTypedContent",
            "cleartextHash": cleartextHash,
            "encryptedCleartext": encryptedCleartext,
            "deviceId": deviceId,
            "keystrokeBiometricsHash": biometricsHash,
            "faceIdVerified": faceIdVerified,
            "appVersion": appVersion,
        ]

        // Build the credential (without proof)
        var credential: [String: Any] = [
            "@context": [vcContext, kwContext],
            "type": ["VerifiableCredential", "KeyWitnessAttestation"],
            "issuer": issuerDID,
            "validFrom": timestamp,
            "credentialSubject": credentialSubject,
            "publicKey": publicKeyB64,  // backward compat
        ]

        // Add credentialStatus if a status index is available
        // The server assigns the statusIndex during upload and the iOS app
        // can include it in subsequent attestations after receiving it.
        if let statusIndex = UserDefaults.standard.object(forKey: "keywitness.lastStatusIndex") as? Int {
            credential["credentialStatus"] = [
                "id": "https://keywitness.io/credentials/status?id=1#\(statusIndex)",
                "type": "BitstringStatusListEntry",
                "statusPurpose": "revocation",
                "statusListIndex": String(statusIndex),
                "statusListCredential": "https://keywitness.io/credentials/status?id=1",
            ] as [String: Any]
        }

        // Sign with eddsa-jcs-2022
        let keystrokeProof = try signEddsaJcs2022(
            credential: credential,
            verificationMethod: verificationMethod,
            created: timestamp,
            proofType: "keystrokeAttestation"
        )

        // Build proof array
        var proofs: [[String: Any]] = [keystrokeProof]

        // Add App Attest proof if available
        if let keyId = appAttestKeyId {
            var appAttestProof: [String: Any] = [
                "type": "AppleAppAttestProof",
                "created": timestamp,
                "keyId": keyId,
                "proofType": "deviceAttestation",
            ]
            if let assertion = appAttestAssertion {
                appAttestProof["assertionData"] = assertion
            }
            if let clientData = appAttestClientData {
                appAttestProof["clientData"] = clientData
            }
            proofs.append(appAttestProof)
        }

        // Assemble final VC
        var vc = credential
        vc["proof"] = proofs.count == 1 ? proofs[0] : proofs

        // Serialize to JSON
        let vcData = try JSONSerialization.data(
            withJSONObject: vc,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )

        // PEM-encode
        let base64url = CryptoEngine.base64URLEncode(vcData)
        let block = """
        -----BEGIN KEYWITNESS ATTESTATION-----
        \(base64url)
        -----END KEYWITNESS ATTESTATION-----
        """

        let encryptionKey = CryptoEngine.aesKeyBase64URL(aesKey)
        return (block: block, encryptionKey: encryptionKey)
    }

    // MARK: - eddsa-jcs-2022 Signing

    /// Sign a credential using the eddsa-jcs-2022 cryptosuite.
    ///
    /// Algorithm:
    /// 1. Canonicalize document (without proof) using JCS → SHA-256 → documentHash
    /// 2. Build proof options (without proofValue) → JCS → SHA-256 → proofOptionsHash
    /// 3. Sign proofOptionsHash || documentHash with Ed25519
    /// 4. Encode signature as multibase (z + base58btc)
    private static func signEddsaJcs2022(
        credential: [String: Any],
        verificationMethod: String,
        created: String,
        proofType: String
    ) throws -> [String: Any] {

        // 1. Canonicalize document (proof is not in it yet)
        let canonicalDocument = JCS.canonicalize(credential)
        let documentHash = SHA256.hash(data: Data(canonicalDocument.utf8))

        // 2. Build proof options
        let proofOptions: [String: Any] = [
            "type": "DataIntegrityProof",
            "cryptosuite": "eddsa-jcs-2022",
            "created": created,
            "verificationMethod": verificationMethod,
            "proofPurpose": "assertionMethod",
            "proofType": proofType,
        ]
        let canonicalProofOptions = JCS.canonicalize(proofOptions)
        let proofOptionsHash = SHA256.hash(data: Data(canonicalProofOptions.utf8))

        // 3. Concatenate hashes (proofOptionsHash || documentHash) = 64 bytes
        var signData = Data()
        signData.append(contentsOf: proofOptionsHash)
        signData.append(contentsOf: documentHash)

        // 4. Sign with Ed25519
        let signature = try CryptoEngine.sign(signData)

        // 5. Encode as multibase z + base58btc
        let proofValue = "z" + Base58.encode(signature)

        // 6. Return complete proof
        var proof = proofOptions
        proof["proofValue"] = proofValue
        return proof
    }
}
