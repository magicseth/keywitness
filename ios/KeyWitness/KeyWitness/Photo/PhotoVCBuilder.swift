import Foundation
import CryptoKit
import ImageIO

/// Builds W3C Verifiable Credential 2.0 attestations for photos.
///
/// The VC proves the photo came directly from the camera with no edits.
/// The image hash in the credential subject is the SHA-256 of the raw
/// AVCapturePhoto data, computed immediately at capture time.
///
/// Also embeds attestation metadata into the image's XMP, making the
/// photo file self-verifying.
final class PhotoVCBuilder {

    // MARK: - Public API

    /// Creates a photo attestation VC and returns the image with XMP metadata embedded.
    /// Returns (block: PEM-armored VC, encryptionKey: base64url AES key, signedImageData: JPEG with XMP).
    static func createVC(
        captureResult: PhotoCaptureResult,
        faceIdVerified: Bool,
        appAttestKeyId: String? = nil,
        appAttestAssertion: String? = nil,
        appAttestClientData: String? = nil
    ) throws -> (block: String, encryptionKey: String, signedImageData: Data) {

        let deviceId = AttestationBuilder.deviceIdentifier()
        let timestamp = AttestationBuilder.iso8601Timestamp()
        let publicKeyData = try CryptoEngine.getOrCreateSigningKey().publicKey.rawRepresentation
        let publicKeyB64 = CryptoEngine.base64URLEncode(publicKeyData)

        NSLog("[PhotoVC] Creating VC: %dx%d, %d bytes, hash=%@",
              captureResult.width, captureResult.height,
              captureResult.imageData.count, captureResult.imageHash)

        // Generate AES-256 key for client-side encryption
        let aesKey = CryptoEngine.generateAESKey()

        // The "cleartext" for a photo is a description — the actual image is in encrypted payload
        let cleartextDesc = "Photo \(captureResult.width)×\(captureResult.height)"
        let cleartextHash = CryptoEngine.sha256Base64URL(Data(cleartextDesc.utf8))

        // Build and encrypt inner payload (image + EXIF + settings)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]

        let imageBase64 = CryptoEngine.base64URLEncode(captureResult.imageData)
        let exifJSON: String
        if let exifData = try? JSONSerialization.data(withJSONObject: captureResult.exifMetadata, options: [.sortedKeys]),
           let exifStr = String(data: exifData, encoding: .utf8) {
            exifJSON = exifStr
        } else {
            exifJSON = "{}"
        }

        let innerPayload = PhotoEncryptedInnerPayload(
            imageBase64: imageBase64,
            exifJSON: exifJSON,
            captureSettings: captureResult.captureSettings
        )
        let innerJSON = try encoder.encode(innerPayload)
        let encryptedData = try CryptoEngine.encryptAESGCM(plaintext: innerJSON, key: aesKey)
        let encryptedCleartext = CryptoEngine.base64URLEncode(encryptedData)

        // Build did:key
        let issuerDID = DIDKey.ed25519ToDIDKey(publicKeyData)
        let verificationMethod = DIDKey.verificationMethodId(for: issuerDID)

        let appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "unknown"

        // Build credential subject
        let credentialSubject: [String: Any] = [
            "type": "UnfilteredPhotograph",
            "cleartextHash": cleartextHash,
            "encryptedCleartext": encryptedCleartext,
            "deviceId": deviceId,
            "imageHash": captureResult.imageHash,
            "exifHash": captureResult.exifHash,
            "imageWidth": captureResult.width,
            "imageHeight": captureResult.height,
            "imageFormat": captureResult.format,
            "imageSizeBytes": captureResult.imageData.count,
            "faceIdVerified": faceIdVerified,
            "appVersion": appVersion,
            "cleartextLength": cleartextDesc.count,
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

        // Add credentialStatus if available
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
        let photoProof = try signEddsaJcs2022(
            credential: credential,
            verificationMethod: verificationMethod,
            created: timestamp,
            proofType: "photoAttestation"
        )

        // Build proof array
        var proofs: [[String: Any]] = [photoProof]

        // Add App Attest proof if available
        if let keyId = appAttestKeyId {
            var appAttestProof: [String: Any] = [
                "type": "AppleAppAttestProof",
                "created": timestamp,
                "keyId": keyId,
                "proofType": "deviceAttestation",
            ]
            if let assertion = appAttestAssertion { appAttestProof["assertionData"] = assertion }
            if let clientData = appAttestClientData { appAttestProof["clientData"] = clientData }
            proofs.append(appAttestProof)
        }

        // Assemble final VC
        var vc = credential
        vc["proof"] = proofs.count == 1 ? proofs[0] : proofs

        let vcData = try JSONSerialization.data(
            withJSONObject: vc,
            options: [.sortedKeys, .withoutEscapingSlashes]
        )

        let base64url = CryptoEngine.base64URLEncode(vcData)
        let block = """
        -----BEGIN KEYWITNESS ATTESTATION-----
        \(base64url)
        -----END KEYWITNESS ATTESTATION-----
        """

        let encryptionKey = CryptoEngine.aesKeyBase64URL(aesKey)

        // Embed attestation into image XMP metadata
        let signedImageData = try embedXMP(
            in: captureResult.imageData,
            signature: photoProof["proofValue"] as? String ?? "",
            imageHash: captureResult.imageHash,
            issuer: issuerDID,
            deviceId: deviceId,
            timestamp: timestamp,
            appVersion: appVersion
        )

        NSLog("[PhotoVC] VC created: %d bytes, proofs=%d, XMP-signed image=%d bytes",
              base64url.count, proofs.count, signedImageData.count)

        return (block: block, encryptionKey: encryptionKey, signedImageData: signedImageData)
    }

    // MARK: - XMP Embedding

    /// Embeds KeyWitness attestation metadata into the image's XMP.
    /// The verification URL is added after upload (see addVerificationURL).
    private static func embedXMP(
        in imageData: Data,
        signature: String,
        imageHash: String,
        issuer: String,
        deviceId: String,
        timestamp: String,
        appVersion: String
    ) throws -> Data {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
              let uti = CGImageSourceGetType(source) else {
            throw PhotoCaptureError.noImageData
        }

        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(mutableData, uti, 1, nil) else {
            throw PhotoCaptureError.noImageData
        }

        // Get existing properties
        var properties = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]) ?? [:]

        // Build XMP packet as a string and embed via IPTC/XMP property
        // CGImageDestination doesn't directly support custom XMP namespaces,
        // so we use the IPTC dictionary for the structured fields and store
        // the full attestation in a well-known property.
        //
        // For maximum compatibility, store attestation fields in IPTC:
        let xmpDict: [String: Any] = [
            "keywitness:signature": signature,
            "keywitness:imageHash": imageHash,
            "keywitness:issuer": issuer,
            "keywitness:deviceId": deviceId,
            "keywitness:timestamp": timestamp,
            "keywitness:appVersion": appVersion,
        ]

        // Serialize attestation metadata as JSON and store in IPTC caption
        if let jsonData = try? JSONSerialization.data(withJSONObject: xmpDict, options: [.sortedKeys]),
           let jsonStr = String(data: jsonData, encoding: .utf8) {

            var iptc = (properties[kCGImagePropertyIPTCDictionary as String] as? [String: Any]) ?? [:]
            iptc[kCGImagePropertyIPTCCaptionAbstract as String] = "KeyWitness Attested Photo"
            iptc[kCGImagePropertyIPTCSpecialInstructions as String] = jsonStr
            properties[kCGImagePropertyIPTCDictionary as String] = iptc
        }

        CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else {
            throw PhotoCaptureError.noImageData
        }

        return mutableData as Data
    }

    /// Updates the signed image with the verification URL after upload.
    static func addVerificationURL(to imageData: Data, url: String) -> Data? {
        guard let source = CGImageSourceCreateWithData(imageData as CFData, nil),
              let uti = CGImageSourceGetType(source) else { return nil }

        let mutableData = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(mutableData, uti, 1, nil) else { return nil }

        var properties = (CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any]) ?? [:]

        // Update the IPTC special instructions JSON with the verification URL
        if var iptc = properties[kCGImagePropertyIPTCDictionary as String] as? [String: Any],
           let existingJSON = iptc[kCGImagePropertyIPTCSpecialInstructions as String] as? String,
           let existingData = existingJSON.data(using: .utf8),
           var dict = try? JSONSerialization.jsonObject(with: existingData) as? [String: Any] {
            dict["keywitness:verificationURL"] = url
            if let updatedData = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
               let updatedStr = String(data: updatedData, encoding: .utf8) {
                iptc[kCGImagePropertyIPTCSpecialInstructions as String] = updatedStr
                properties[kCGImagePropertyIPTCDictionary as String] = iptc
            }
        }

        CGImageDestinationAddImageFromSource(destination, source, 0, properties as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { return nil }

        return mutableData as Data
    }

    // MARK: - eddsa-jcs-2022 Signing

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
