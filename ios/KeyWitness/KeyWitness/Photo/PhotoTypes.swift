import Foundation
import AVFoundation

// MARK: - Photo Capture Result

/// Result from capturing a photo, before attestation.
struct PhotoCaptureResult {
    let imageData: Data            // Raw JPEG file data from AVCapturePhoto
    let imageHash: String          // SHA-256 of imageData, base64url
    let exifMetadata: [String: Any]
    let exifHash: String           // SHA-256 of serialized EXIF, base64url
    let captureSettings: CaptureSettings
    let width: Int
    let height: Int
    let format: String             // "jpeg" or "heic"
}

// MARK: - Capture Settings

/// Camera settings at capture time — proves the image came from a live capture.
struct CaptureSettings: Codable {
    let exposureDuration: String   // e.g. "1/120"
    let iso: Float
    let focalLength: Float
    let lensPosition: Float
    let flashFired: Bool
    let whiteBalance: String       // e.g. "auto"

    static func from(resolvedSettings: AVCaptureResolvedPhotoSettings, device: AVCaptureDevice?) -> CaptureSettings {
        let duration = device?.exposureDuration ?? CMTime(value: 1, timescale: 120)
        let exposureStr: String
        if duration.timescale > 0 && duration.value > 0 {
            exposureStr = "1/\(duration.timescale / Int32(duration.value))"
        } else {
            exposureStr = "unknown"
        }

        return CaptureSettings(
            exposureDuration: exposureStr,
            iso: device?.iso ?? 0,
            focalLength: device?.activeFormat.videoFieldOfView ?? 0,
            lensPosition: device?.lensPosition ?? 0,
            flashFired: resolvedSettings.isFlashEnabled,
            whiteBalance: "auto"
        )
    }
}

// MARK: - Photo Encrypted Inner Payload

/// The inner payload that gets AES-GCM encrypted for photo attestations.
/// Contains the image data and EXIF so they're never in plaintext on the server.
struct PhotoEncryptedInnerPayload: Codable {
    let imageBase64: String        // Base64url of image file data
    let exifJSON: String           // Serialized EXIF metadata
    let captureSettings: CaptureSettings
}

// MARK: - XMP Attestation

/// Metadata fields embedded into the photo's XMP namespace.
struct XMPAttestation {
    static let namespace = "http://keywitness.io/ns/photo/1.0/"
    static let prefix = "keywitness"

    let signature: String          // Ed25519 signature (base64url)
    let imageHash: String          // SHA-256 of raw image data (pre-XMP)
    let issuer: String             // did:key
    let deviceId: String
    let timestamp: String          // ISO 8601
    let verificationURL: String    // URL to verify
    let appVersion: String
}
