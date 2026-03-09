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
    let score: Float             // Combined liveness score 0.0-1.0
    let windowCount: Int         // number of analysis windows
    let method: String           // e.g. "multi-v2"
}

// MARK: - Calibration

/// A calibration prompt shown to the user before free speech.
struct CalibrationPrompt {
    let text: String
    let minimumDurationMs: Int

    /// Phonetically diverse prompts that exercise all mouth shapes:
    /// - Wide jaw: "ah", "aw", "pa", "ba"
    /// - Lip rounding: "oo", "oh", "who", "moon"
    /// - Lip spread: "ee", "cheese", "three", "pleased"
    /// - Lip closure: "m", "b", "p", "map", "bump"
    /// - Upper lip / teeth: "f", "v", "five", "valve"
    /// - Pucker: "w", "woo", "blue", "flew"
    static let prompts: [CalibrationPrompt] = [
        CalibrationPrompt(
            text: "Bobby bought five blue balloons for my birthday party",
            minimumDurationMs: 4000
            // b/p → mouthClose, "five" → upperLip, "blue/balloons" → pucker, "party" → wide jaw
        ),
        CalibrationPrompt(
            text: "We flew above the moon and viewed a few purple volcanoes",
            minimumDurationMs: 4500
            // "flew/few" → pucker, "moon" → funnel, "viewed" → spread+round, "volcanoes" → open jaw, "purple" → lip closure
        ),
        CalibrationPrompt(
            text: "My father's vacuum moves from five rooms to three bathrooms",
            minimumDurationMs: 4500
            // "father's/five" → upper lip + teeth, "vacuum/moves" → closure + funnel, "rooms/three/bathrooms" → spread + round
        ),
        CalibrationPrompt(
            text: "She chose a beautiful fuchsia scarf from the famous boutique",
            minimumDurationMs: 4500
            // "she/chose" → pucker, "beautiful" → spread, "fuchsia/from/famous" → upper lip, "scarf" → wide jaw, "boutique" → round
        ),
        CalibrationPrompt(
            text: "Please give me twelve heavy bags of fresh walnuts and peaches",
            minimumDurationMs: 4500
            // "please/peaches" → spread, "give" → upper lip, "twelve/heavy" → teeth, "bags/walnuts" → wide jaw, "of/fresh" → f-sound
        ),
        CalibrationPrompt(
            text: "The smooth blue whale floated above five frozen waves forever",
            minimumDurationMs: 4500
            // "smooth/blue" → pucker, "whale" → wide, "floated/five/frozen/forever" → upper lip, "above" → wide jaw, "waves" → round
        ),
    ]

    /// Pick a random calibration prompt.
    static func random() -> CalibrationPrompt {
        return prompts.randomElement()!
    }
}

/// Result from the calibration phase.
struct CalibrationResult {
    let lagMs: Float              // Measured audio→mesh lag
    let meshFrames: [FaceMeshFrame]
    let audioSamples: [Float]
    let durationMs: Int
}

// MARK: - Voice Encrypted Inner Payload

/// The inner payload that gets AES-GCM encrypted for voice attestations.
struct VoiceEncryptedInnerPayload: Codable {
    let cleartext: String
    let faceMeshTimeSeries: [FaceMeshFrame]
    let audioMeshCorrelation: AudioMeshCorrelation
}
