import Foundation

// MARK: - Face Mesh Frame

/// A single frame of face mesh blend shape data captured during recording.
/// Only mouth-related blend shapes are stored (speech-relevant).
struct FaceMeshFrame: Codable {
    let t: TimeInterval          // ms relative to recording start
    let jawOpen: Float
    let mouthClose: Float
    let mouthFunnel: Float
    let mouthPucker: Float
    let mouthLeft: Float
    let mouthRight: Float
    let mouthSmileLeft: Float
    let mouthSmileRight: Float
    let mouthUpperUpLeft: Float
    let mouthUpperUpRight: Float
    let mouthLowerDownLeft: Float
    let mouthLowerDownRight: Float
}

// MARK: - Audio-Mesh Correlation

/// Result of correlating audio energy envelope with mouth movement.
struct AudioMeshCorrelation: Codable {
    let score: Float             // Pearson correlation 0.0-1.0
    let windowCount: Int         // number of analysis windows
    let method: String           // e.g. "energy-jawopen-v1"
}

// MARK: - Voice Encrypted Inner Payload

/// The inner payload that gets AES-GCM encrypted for voice attestations.
struct VoiceEncryptedInnerPayload: Codable {
    let cleartext: String
    let faceMeshTimeSeries: [FaceMeshFrame]
    let audioMeshCorrelation: AudioMeshCorrelation
}
