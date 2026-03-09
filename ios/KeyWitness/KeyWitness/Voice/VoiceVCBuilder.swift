import Foundation
import CryptoKit

/// Builds W3C Verifiable Credential 2.0 attestations for voice input.
///
/// Follows the same structure as VCBuilder (for keystrokes) but with
/// voice-specific credential subject fields: audioHash, faceMeshBiometricsHash,
/// audioMeshCorrelationScore, and inputSource.
final class VoiceVCBuilder {

    // MARK: - Public API

    /// Creates a voice attestation VC.
    /// Returns (block: PEM-armored VC, encryptionKey: base64url AES key).
    static func createVC(
        cleartext: String,
        audioHash: String,
        faceMeshFrames: [FaceMeshFrame],
        audioMeshCorrelation: AudioMeshCorrelation,
        faceIdVerified: Bool,
        inputSource: String,
        audioDurationMs: Int,
        appAttestKeyId: String? = nil,
        appAttestAssertion: String? = nil,
        appAttestClientData: String? = nil
    ) throws -> (block: String, encryptionKey: String) {

        let deviceId = AttestationBuilder.deviceIdentifier()
        let timestamp = AttestationBuilder.iso8601Timestamp()
        let publicKeyData = try CryptoEngine.getOrCreateSigningKey().publicKey.rawRepresentation
        let publicKeyB64 = CryptoEngine.base64URLEncode(publicKeyData)

        // Generate AES-256 key for client-side encryption
        let aesKey = CryptoEngine.generateAESKey()

        // Compute cleartext hash
        let cleartextHash = CryptoEngine.sha256Base64URL(Data(cleartext.utf8))

        // Compute face mesh biometrics hash
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let meshJSON = try encoder.encode(faceMeshFrames)
        let faceMeshHash = CryptoEngine.sha256Base64URL(meshJSON)

        // Build and encrypt inner payload
        let innerPayload = VoiceEncryptedInnerPayload(
            cleartext: cleartext,
            faceMeshTimeSeries: faceMeshFrames,
            audioMeshCorrelation: audioMeshCorrelation
        )
        let innerJSON = try encoder.encode(innerPayload)
        let encryptedData = try CryptoEngine.encryptAESGCM(plaintext: innerJSON, key: aesKey)
        let encryptedCleartext = CryptoEngine.base64URLEncode(encryptedData)

        // Build did:key identifier
        let issuerDID = DIDKey.ed25519ToDIDKey(publicKeyData)
        let verificationMethod = DIDKey.verificationMethodId(for: issuerDID)

        // Get app version
        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"

        // Build credential subject
        let credentialSubject: [String: Any] = [
            "type": "HumanSpokenContent",
            "cleartextHash": cleartextHash,
            "encryptedCleartext": encryptedCleartext,
            "deviceId": deviceId,
            "audioHash": audioHash,
            "faceMeshBiometricsHash": faceMeshHash,
            "audioMeshCorrelationScore": audioMeshCorrelation.score,
            "inputSource": inputSource,
            "faceIdVerified": faceIdVerified,
            "appVersion": appVersion,
            "cleartextLength": cleartext.count,
            "audioDurationMs": audioDurationMs,
        ]

        // Build the credential (without proof)
        var credential: [String: Any] = [
            "@context": [VCBuilder.vcContext, VCBuilder.kwContext],
            "type": ["VerifiableCredential", "KeyWitnessAttestation"],
            "issuer": issuerDID,
            "validFrom": timestamp,
            "credentialSubject": credentialSubject,
            "publicKey": publicKeyB64,
        ]

        // Add credentialStatus if a status index is available
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
        let voiceProof = try signEddsaJcs2022(
            credential: credential,
            verificationMethod: verificationMethod,
            created: timestamp,
            proofType: "voiceAttestation"
        )

        // Build proof array
        var proofs: [[String: Any]] = [voiceProof]

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

    // MARK: - eddsa-jcs-2022 Signing (identical to VCBuilder)

    private static func signEddsaJcs2022(
        credential: [String: Any],
        verificationMethod: String,
        created: String,
        proofType: String
    ) throws -> [String: Any] {

        let canonicalDocument = JCS.canonicalize(credential)
        let documentHash = SHA256.hash(data: Data(canonicalDocument.utf8))

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

        var signData = Data()
        signData.append(contentsOf: proofOptionsHash)
        signData.append(contentsOf: documentHash)

        let signature = try CryptoEngine.sign(signData)
        let proofValue = "z" + Base58.encode(signature)

        var proof = proofOptions
        proof["proofValue"] = proofValue
        return proof
    }
}
