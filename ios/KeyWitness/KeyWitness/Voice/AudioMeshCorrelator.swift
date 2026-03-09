import Foundation
import Accelerate

/// Multi-feature audio-mesh liveness analysis.
///
/// Improvements over naive Pearson(audioRMS, jawOpen):
/// - Composite mouth signal: jawOpen + lowerLip + upperLip - mouthClose
///   (captures overall "mouth active" state, not just jaw)
/// - Log-scaled audio energy (matches human perception)
/// - Smoothed signals (3-window moving average reduces noise)
/// - Cross-correlation lag detection from calibration phase
/// - Velocity (derivative) correlation catches sharp phoneme transitions
/// - Blend shape ensemble: real speech activates many shapes, lip sync mainly jaw
final class AudioMeshCorrelator {

    static let windowMs: Double = 50
    static let maxLagMs: Double = 500
    static let smoothingWindow = 3  // 150ms smoothing at 50ms windows

    struct DetailedResult {
        let score: Float
        let lagMs: Float
        let pearsonR: Float
        let velocityCorrelation: Float
        let ensembleVariance: Float
        let silenceDiscrimination: Float
        let windowCount: Int
        let method: String
    }

    // MARK: - Main Entry Point

    static func correlate(
        audioSamples: [Float],
        sampleRate: Double,
        meshFrames: [FaceMeshFrame],
        recordingDuration: TimeInterval,
        calibratedLagMs: Float? = nil
    ) -> AudioMeshCorrelation {
        let detailed = correlateDetailed(
            audioSamples: audioSamples,
            sampleRate: sampleRate,
            meshFrames: meshFrames,
            recordingDuration: recordingDuration,
            calibratedLagMs: calibratedLagMs
        )
        return AudioMeshCorrelation(
            score: detailed.score,
            windowCount: detailed.windowCount,
            method: detailed.method
        )
    }

    static func correlateDetailed(
        audioSamples: [Float],
        sampleRate: Double,
        meshFrames: [FaceMeshFrame],
        recordingDuration: TimeInterval,
        calibratedLagMs: Float? = nil
    ) -> DetailedResult {
        let windowSamples = Int(sampleRate * windowMs / 1000.0)
        let windowCount = audioSamples.count / windowSamples

        guard windowCount > 6, meshFrames.count > 6 else {
            NSLog("[Correlator] Insufficient data: %d windows, %d mesh frames", windowCount, meshFrames.count)
            return DetailedResult(score: 0, lagMs: 0, pearsonR: 0, velocityCorrelation: 0,
                                  ensembleVariance: 0, silenceDiscrimination: 0,
                                  windowCount: windowCount, method: "multi-v3")
        }

        NSLog("[Correlator] Analyzing: %d windows (%.0fms each), %d mesh frames, %.1fs, calibratedLag=%@",
              windowCount, windowMs, meshFrames.count, recordingDuration,
              calibratedLagMs.map { String(format: "%.0fms", $0) } ?? "auto")

        // 1. Compute log-scaled audio energy per window
        var rawAudioEnergy = [Float](repeating: 0, count: windowCount)
        for i in 0..<windowCount {
            let start = i * windowSamples
            let end = min(start + windowSamples, audioSamples.count)
            let slice = Array(audioSamples[start..<end])
            var rms: Float = 0
            vDSP_rmsqv(slice, 1, &rms, vDSP_Length(slice.count))
            rawAudioEnergy[i] = rms
        }
        // Log-scale: log(1 + rms * 1000) to spread out the dynamic range
        var audioEnergy = rawAudioEnergy.map { log(1.0 + $0 * 1000.0) }

        // 2. Interpolate blend shapes and build composite mouth signal
        var jawOpen = [Float](repeating: 0, count: windowCount)
        var mouthFunnel = [Float](repeating: 0, count: windowCount)
        var mouthPucker = [Float](repeating: 0, count: windowCount)
        var mouthClose = [Float](repeating: 0, count: windowCount)
        var upperLip = [Float](repeating: 0, count: windowCount)
        var lowerLip = [Float](repeating: 0, count: windowCount)

        for i in 0..<windowCount {
            let windowTimeMs = Double(i) * windowMs
            let closest = meshFrames.min(by: { abs($0.t - windowTimeMs) < abs($1.t - windowTimeMs) })!
            jawOpen[i] = closest.jawOpen
            mouthFunnel[i] = closest.mouthFunnel
            mouthPucker[i] = closest.mouthPucker
            mouthClose[i] = closest.mouthClose
            upperLip[i] = (closest.mouthUpperUpLeft + closest.mouthUpperUpRight) / 2
            lowerLip[i] = (closest.mouthLowerDownLeft + closest.mouthLowerDownRight) / 2
        }

        // Composite mouth signal: captures overall "mouth is doing something for speech"
        // jawOpen + lowerLip + upperLip + funnel + pucker - mouthClose
        var mouthActivity = [Float](repeating: 0, count: windowCount)
        for i in 0..<windowCount {
            mouthActivity[i] = jawOpen[i] + lowerLip[i] + upperLip[i]
                + mouthFunnel[i] * 0.5 + mouthPucker[i] * 0.5
                - mouthClose[i] * 0.3
        }

        // 3. Smooth both signals (moving average)
        audioEnergy = smooth(audioEnergy, window: smoothingWindow)
        mouthActivity = smooth(mouthActivity, window: smoothingWindow)
        let smoothJaw = smooth(jawOpen, window: smoothingWindow)

        // Log signal stats
        let audioMin = audioEnergy.min() ?? 0, audioMax = audioEnergy.max() ?? 0
        let mouthMin = mouthActivity.min() ?? 0, mouthMax = mouthActivity.max() ?? 0
        NSLog("[Correlator] Smoothed ranges: audio=[%.2f, %.2f], mouth=[%.3f, %.3f]",
              audioMin, audioMax, mouthMin, mouthMax)

        // Feature 1: Lag detection + Pearson r on composite mouth signal
        let lagWindows: Int
        let pearsonAtLag: Float

        if let calLag = calibratedLagMs {
            lagWindows = max(0, Int(Double(calLag) / windowMs))
            pearsonAtLag = laggedPearson(signal: audioEnergy, reference: mouthActivity, lag: lagWindows)
            NSLog("[Correlator] Calibrated lag: %d windows (%.0fms), Pearson r=%.4f",
                  lagWindows, calLag, pearsonAtLag)
        } else {
            let maxLagW = Int(maxLagMs / windowMs)
            let result = findOptimalLag(signal: audioEnergy, reference: mouthActivity, maxLag: maxLagW)
            lagWindows = result.lag
            pearsonAtLag = result.pearson
            NSLog("[Correlator] Auto lag: %d windows (%.0fms), Pearson r=%.4f",
                  lagWindows, Float(lagWindows) * Float(windowMs), pearsonAtLag)
        }

        let lagMs = Float(lagWindows) * Float(windowMs)

        // Feature 2: Velocity correlation (on smoothed signals)
        let audioVel = derivative(audioEnergy)
        let mouthVel = derivative(mouthActivity)
        let velocityCorr = laggedPearson(signal: audioVel, reference: mouthVel, lag: lagWindows)
        NSLog("[Correlator] Velocity correlation: %.4f", velocityCorr)

        // Feature 3: Blend shape ensemble
        let ensembleScore = blendShapeEnsembleScore(
            audioEnergy: rawAudioEnergy,  // use raw for threshold splitting
            jawOpen: jawOpen, mouthFunnel: mouthFunnel, mouthPucker: mouthPucker,
            mouthClose: mouthClose, upperLip: upperLip, lowerLip: lowerLip,
            lag: lagWindows
        )
        NSLog("[Correlator] Ensemble score: %.4f", ensembleScore)

        // Feature 4: Speech/silence jaw discrimination
        let silenceDisc = speechSilenceDiscrimination(
            audioEnergy: rawAudioEnergy,
            mouthActivity: mouthActivity,
            lag: lagWindows
        )
        NSLog("[Correlator] Silence discrimination: %.4f", silenceDisc)

        // Combine: generous scoring for real speech
        // Real speech should get 0.5-0.8 on pearson, 0.3-0.6 on velocity
        let pR = max(0, pearsonAtLag)
        let vC = max(0, velocityCorr)

        // Scale pearson: 0.3 → 0.5, 0.5 → 0.8, 0.7 → 1.0
        let scaledPearson = min(1.0, max(0, (pR - 0.1) / 0.6))
        // Scale velocity: 0.2 → 0.5, 0.4 → 0.8, 0.5 → 1.0
        let scaledVelocity = min(1.0, max(0, (vC - 0.05) / 0.45))

        let combined = (
            scaledPearson * 0.30 +
            scaledVelocity * 0.25 +
            ensembleScore * 0.25 +
            silenceDisc * 0.20
        )
        let finalScore = min(1.0, max(0, combined))

        NSLog("[Correlator] Final: pearsonR=%.3f→%.3f(×0.30) + velocity=%.3f→%.3f(×0.25) + ensemble=%.3f(×0.25) + silence=%.3f(×0.20) = %.3f",
              pR, scaledPearson, vC, scaledVelocity, ensembleScore, silenceDisc, finalScore)

        return DetailedResult(
            score: finalScore,
            lagMs: lagMs,
            pearsonR: pR,
            velocityCorrelation: vC,
            ensembleVariance: ensembleScore,
            silenceDiscrimination: silenceDisc,
            windowCount: windowCount,
            method: "multi-v3"
        )
    }

    // MARK: - Smoothing

    private static func smooth(_ signal: [Float], window: Int) -> [Float] {
        guard signal.count > window else { return signal }
        var result = [Float](repeating: 0, count: signal.count)
        let half = window / 2
        for i in 0..<signal.count {
            let lo = max(0, i - half)
            let hi = min(signal.count - 1, i + half)
            let count = hi - lo + 1
            var sum: Float = 0
            for j in lo...hi { sum += signal[j] }
            result[i] = sum / Float(count)
        }
        return result
    }

    // MARK: - Cross-Correlation Lag Detection

    private static func findOptimalLag(signal: [Float], reference: [Float], maxLag: Int) -> (lag: Int, pearson: Float) {
        var bestLag = 0
        var bestR: Float = -2

        for lag in 0...min(maxLag, signal.count / 4) {
            let r = laggedPearson(signal: signal, reference: reference, lag: lag)
            if r > bestR {
                bestR = r
                bestLag = lag
            }
        }
        return (bestLag, bestR)
    }

    private static func laggedPearson(signal: [Float], reference: [Float], lag: Int) -> Float {
        let n = min(signal.count, reference.count) - lag
        guard n > 2 else { return 0 }
        return pearsonCorrelation(Array(signal[0..<n]), Array(reference[lag..<(lag + n)]))
    }

    // MARK: - Derivative

    private static func derivative(_ signal: [Float]) -> [Float] {
        guard signal.count > 1 else { return [] }
        var d = [Float](repeating: 0, count: signal.count - 1)
        for i in 0..<d.count { d[i] = signal[i + 1] - signal[i] }
        return d
    }

    // MARK: - Blend Shape Ensemble

    private static func blendShapeEnsembleScore(
        audioEnergy: [Float],
        jawOpen: [Float], mouthFunnel: [Float], mouthPucker: [Float],
        mouthClose: [Float], upperLip: [Float], lowerLip: [Float],
        lag: Int
    ) -> Float {
        let n = min(audioEnergy.count, jawOpen.count) - lag
        guard n > 4 else { return 0 }

        // Adaptive medians as resting baseline
        let allShapes: [[Float]] = [jawOpen, mouthFunnel, mouthPucker, mouthClose, upperLip, lowerLip]
        let medians: [Float] = allShapes.map { shape in
            let valid = Array(shape[lag..<(lag + n)])
            return valid.sorted()[valid.count / 2]
        }

        let sortedEnergy = audioEnergy[0..<n].sorted()
        let silenceThreshold = sortedEnergy[n / 3]

        var speechActive: [Float] = []
        var silenceActive: [Float] = []

        for i in 0..<n {
            let mi = i + lag
            guard mi < jawOpen.count else { continue }
            let shapes: [Float] = [jawOpen[mi], mouthFunnel[mi], mouthPucker[mi],
                                    mouthClose[mi], upperLip[mi], lowerLip[mi]]
            var active: Float = 0
            for (j, val) in shapes.enumerated() {
                if val > medians[j] + 0.015 { active += 1 }
            }
            if audioEnergy[i] > silenceThreshold {
                speechActive.append(active)
            } else {
                silenceActive.append(active)
            }
        }

        guard !speechActive.isEmpty else { return 0 }
        let speechMean = speechActive.reduce(0, +) / Float(speechActive.count)
        let silenceMean = silenceActive.isEmpty ? 0 : silenceActive.reduce(0, +) / Float(silenceActive.count)
        let diff = speechMean - silenceMean

        // Scale: diff of 1.0 → 0.5, diff of 2.0 → 1.0
        let score = min(1.0, max(0, diff / 2.0))

        NSLog("[Correlator] Ensemble: speech=%.1f above-median, silence=%.1f, diff=%.1f → score=%.3f",
              speechMean, silenceMean, diff, score)
        return score
    }

    // MARK: - Speech/Silence Discrimination

    private static func speechSilenceDiscrimination(
        audioEnergy: [Float],
        mouthActivity: [Float],
        lag: Int
    ) -> Float {
        let n = min(audioEnergy.count, mouthActivity.count) - lag
        guard n > 4 else { return 0 }

        let sortedEnergy = audioEnergy[0..<n].sorted()
        let silenceThreshold = sortedEnergy[n / 3]

        var speechMouth: [Float] = []
        var silenceMouth: [Float] = []

        for i in 0..<n {
            let mi = i + lag
            guard mi < mouthActivity.count else { continue }
            if audioEnergy[i] > silenceThreshold {
                speechMouth.append(mouthActivity[mi])
            } else {
                silenceMouth.append(mouthActivity[mi])
            }
        }

        guard !speechMouth.isEmpty, !silenceMouth.isEmpty else { return 0 }

        let speechMean = speechMouth.reduce(0, +) / Float(speechMouth.count)
        let silenceMean = silenceMouth.reduce(0, +) / Float(silenceMouth.count)
        let speechVar = speechMouth.map { ($0 - speechMean) * ($0 - speechMean) }.reduce(0, +) / Float(speechMouth.count)

        let mouthRange = (mouthActivity.max() ?? 0) - (mouthActivity.min() ?? 0)
        guard mouthRange > 0.01 else { return 0 }

        let normDiff = (speechMean - silenceMean) / mouthRange
        let normStd = sqrt(speechVar) / mouthRange

        // Scale generously: normDiff of 0.2 + normStd of 0.2 → ~0.7
        let score = min(1.0, max(0, normDiff * 2.5 + normStd * 2.0))

        NSLog("[Correlator] Speech/silence: speechMouth=%.3f±%.3f, silenceMouth=%.3f, range=%.3f, normDiff=%.3f → score=%.3f",
              speechMean, sqrt(speechVar), silenceMean, mouthRange, normDiff, score)
        return score
    }

    // MARK: - Pearson Correlation

    private static func pearsonCorrelation(_ x: [Float], _ y: [Float]) -> Float {
        let count = min(x.count, y.count)
        let n = vDSP_Length(count)
        guard n > 1 else { return 0 }

        let xS = Array(x.prefix(count)), yS = Array(y.prefix(count))
        var meanX: Float = 0, meanY: Float = 0
        vDSP_meanv(xS, 1, &meanX, n)
        vDSP_meanv(yS, 1, &meanY, n)

        var dx = [Float](repeating: 0, count: count)
        var dy = [Float](repeating: 0, count: count)
        var negMX = -meanX, negMY = -meanY
        vDSP_vsadd(xS, 1, &negMX, &dx, 1, n)
        vDSP_vsadd(yS, 1, &negMY, &dy, 1, n)

        var dot: Float = 0, ssX: Float = 0, ssY: Float = 0
        vDSP_dotpr(dx, 1, dy, 1, &dot, n)
        vDSP_dotpr(dx, 1, dx, 1, &ssX, n)
        vDSP_dotpr(dy, 1, dy, 1, &ssY, n)

        let denom = sqrt(ssX * ssY)
        guard denom > 0 else { return 0 }
        return dot / denom
    }
}
