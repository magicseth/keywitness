import Foundation
import Accelerate

/// Correlates audio energy with mouth movement to prove liveness.
///
/// The core idea: when someone speaks, their jaw opens and closes in sync
/// with the audio energy. We compute the Pearson correlation between
/// the audio RMS envelope and the jawOpen blend shape over time.
/// A high correlation (> 0.5) strongly indicates a real person speaking.
final class AudioMeshCorrelator {

    /// Window size for audio energy computation, in milliseconds.
    static let windowMs: TimeInterval = 100

    /// Correlate audio energy envelope with face mesh jawOpen signal.
    ///
    /// - Parameters:
    ///   - audioSamples: Raw PCM samples (Float32, mono)
    ///   - sampleRate: Audio sample rate (e.g. 16000)
    ///   - meshFrames: Face mesh frames captured during recording
    ///   - recordingDuration: Total recording duration in seconds
    /// - Returns: Correlation result
    static func correlate(
        audioSamples: [Float],
        sampleRate: Double,
        meshFrames: [FaceMeshFrame],
        recordingDuration: TimeInterval
    ) -> AudioMeshCorrelation {

        guard !audioSamples.isEmpty, !meshFrames.isEmpty, recordingDuration > 0 else {
            return AudioMeshCorrelation(score: 0, windowCount: 0, method: "energy-jawopen-v1")
        }

        let windowSamples = Int(sampleRate * windowMs / 1000.0)
        let windowCount = audioSamples.count / windowSamples

        guard windowCount > 2 else {
            return AudioMeshCorrelation(score: 0, windowCount: windowCount, method: "energy-jawopen-v1")
        }

        // 1. Compute audio RMS per window
        var audioEnergy = [Float](repeating: 0, count: windowCount)
        for i in 0..<windowCount {
            let start = i * windowSamples
            let end = min(start + windowSamples, audioSamples.count)
            let slice = Array(audioSamples[start..<end])
            var rms: Float = 0
            vDSP_rmsqv(slice, 1, &rms, vDSP_Length(slice.count))
            audioEnergy[i] = rms
        }

        // 2. Compute jawOpen per window (interpolate from mesh frames)
        var mouthSignal = [Float](repeating: 0, count: windowCount)
        for i in 0..<windowCount {
            let windowTimeMs = Double(i) * windowMs
            // Find closest mesh frame
            let closest = meshFrames.min(by: { abs($0.t - windowTimeMs) < abs($1.t - windowTimeMs) })
            mouthSignal[i] = closest?.jawOpen ?? 0
        }

        // 3. Pearson correlation
        let score = pearsonCorrelation(audioEnergy, mouthSignal)

        return AudioMeshCorrelation(
            score: max(0, score),  // clamp negative correlations to 0
            windowCount: windowCount,
            method: "energy-jawopen-v1"
        )
    }

    /// Pearson correlation coefficient between two equal-length arrays.
    private static func pearsonCorrelation(_ x: [Float], _ y: [Float]) -> Float {
        let n = vDSP_Length(x.count)
        guard n > 1 else { return 0 }

        var meanX: Float = 0, meanY: Float = 0
        vDSP_meanv(x, 1, &meanX, n)
        vDSP_meanv(y, 1, &meanY, n)

        // Subtract means
        var dx = [Float](repeating: 0, count: x.count)
        var dy = [Float](repeating: 0, count: y.count)
        var negMeanX = -meanX, negMeanY = -meanY
        vDSP_vsadd(x, 1, &negMeanX, &dx, 1, n)
        vDSP_vsadd(y, 1, &negMeanY, &dy, 1, n)

        // Dot product of deviations
        var dotProduct: Float = 0
        vDSP_dotpr(dx, 1, dy, 1, &dotProduct, n)

        // Standard deviations
        var sumSqX: Float = 0, sumSqY: Float = 0
        vDSP_dotpr(dx, 1, dx, 1, &sumSqX, n)
        vDSP_dotpr(dy, 1, dy, 1, &sumSqY, n)

        let denominator = sqrt(sumSqX * sumSqY)
        guard denominator > 0 else { return 0 }

        return dotProduct / denominator
    }
}
