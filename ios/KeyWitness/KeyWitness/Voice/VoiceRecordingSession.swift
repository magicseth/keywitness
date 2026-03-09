import Foundation
import AVFoundation
import Speech
import ARKit
import CryptoKit

/// Orchestrates concurrent audio capture, on-device speech recognition,
/// and ARKit face mesh tracking for voice attestation.
///
/// Flow:
/// 1. `startCalibration()` — user reads a known prompt (measures lag)
/// 2. `endCalibration()` — compute lag from calibration data
/// 3. `startRecording()` — user speaks freely
/// 4. `stopRecording()` — returns result with calibrated analysis
final class VoiceRecordingSession: NSObject, ARSessionDelegate {

    // MARK: - Result

    struct Result {
        let transcription: String
        let audioHash: String           // SHA-256 of raw PCM, base64url
        let faceMeshFrames: [FaceMeshFrame]
        let audioMeshCorrelation: AudioMeshCorrelation
        let inputSource: String         // e.g. "builtInMicrophone"
        let audioDurationMs: Int
        let calibrationLagMs: Float
    }

    enum Phase {
        case idle
        case calibrating
        case recording
    }

    // MARK: - State

    private let audioEngine = AVAudioEngine()
    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?

    let arSession = ARSession()
    private var meshFrames: [FaceMeshFrame] = []
    private var audioSamples: [Float] = []
    private var sampleRate: Double = 16000

    private var recordingStartTime: TimeInterval = 0
    private var lastMeshSampleTime: TimeInterval = 0
    private let meshSampleIntervalMs: TimeInterval = 50  // 20 Hz for better resolution

    private var currentTranscription = ""
    private(set) var phase: Phase = .idle

    // Calibration state
    private var calibrationMeshFrames: [FaceMeshFrame] = []
    private var calibrationAudioSamples: [Float] = []
    private var calibrationStartTime: TimeInterval = 0
    private var calibrationLagMs: Float = 100  // default until measured
    private(set) var calibrationPrompt: CalibrationPrompt = .random()

    /// Called on main thread whenever transcription updates.
    var onTranscriptionUpdate: ((String) -> Void)?

    /// Called on main thread when face tracking state changes.
    var onFaceTrackingUpdate: ((Bool) -> Void)?

    // MARK: - Permissions

    static func requestPermissions() async -> (mic: Bool, speech: Bool, camera: Bool) {
        let mic = await withCheckedContinuation { cont in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                cont.resume(returning: granted)
            }
        }

        let speech = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { status in
                cont.resume(returning: status == .authorized)
            }
        }

        var camera = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        if !camera {
            camera = await AVCaptureDevice.requestAccess(for: .video)
        }

        return (mic, speech, camera)
    }

    // MARK: - Start (shared setup for calibration and recording)

    private func startCapture() throws {
        // Start ARKit face tracking first (claims the camera)
        guard ARFaceTrackingConfiguration.isSupported else {
            throw VoiceRecordingError.faceTrackingUnsupported
        }
        let arConfig = ARFaceTrackingConfiguration()
        arConfig.isLightEstimationEnabled = false
        arSession.delegate = self
        arSession.run(arConfig, options: [.resetTracking, .removeExistingAnchors])

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try audioSession.setActive(true)

        let inputSource = verifyInputSource(audioSession)
        NSLog("[VoiceAttest] Input source: %@", inputSource)

        // Set up speech recognizer (on-device only)
        speechRecognizer = SFSpeechRecognizer(locale: Locale.current)
        guard let speechRecognizer, speechRecognizer.isAvailable else {
            throw VoiceRecordingError.speechRecognizerUnavailable
        }
        speechRecognizer.supportsOnDeviceRecognition = true

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest else {
            throw VoiceRecordingError.speechRecognizerUnavailable
        }
        recognitionRequest.requiresOnDeviceRecognition = true
        recognitionRequest.shouldReportPartialResults = true

        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            if let result {
                let text = result.bestTranscription.formattedString
                self?.currentTranscription = text
                DispatchQueue.main.async {
                    self?.onTranscriptionUpdate?(text)
                }
            }
            if let error {
                NSLog("[VoiceAttest] Speech recognition error: %@", error.localizedDescription)
            }
        }

        // Set up audio engine
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        sampleRate = recordingFormat.sampleRate

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)

            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameCount = Int(buffer.frameLength)
            let samples = Array(UnsafeBufferPointer(start: channelData, count: frameCount))

            guard let self else { return }
            if self.phase == .calibrating {
                self.calibrationAudioSamples.append(contentsOf: samples)
            } else if self.phase == .recording {
                self.audioSamples.append(contentsOf: samples)
            }
        }

        try audioEngine.start()
        recordingStartTime = ProcessInfo.processInfo.systemUptime
        lastMeshSampleTime = 0
    }

    private func stopCapture() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        arSession.pause()

        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest = nil
        speechRecognizer = nil
    }

    // MARK: - Calibration Phase

    func startCalibration() throws {
        guard phase == .idle else { return }

        calibrationPrompt = .random()
        calibrationMeshFrames.removeAll()
        calibrationAudioSamples.removeAll()

        try startCapture()
        calibrationStartTime = ProcessInfo.processInfo.systemUptime
        phase = .calibrating

        NSLog("[VoiceAttest] Calibration started: prompt='%@'", calibrationPrompt.text)
    }

    func endCalibration() -> CalibrationResult {
        guard phase == .calibrating else {
            return CalibrationResult(lagMs: 100, meshFrames: [], audioSamples: [], durationMs: 0)
        }

        let duration = ProcessInfo.processInfo.systemUptime - calibrationStartTime
        let durationMs = Int(duration * 1000)

        NSLog("[VoiceAttest] Calibration ended: %d mesh frames, %d audio samples, %dms",
              calibrationMeshFrames.count, calibrationAudioSamples.count, durationMs)

        // Measure lag from calibration data
        let lagResult = AudioMeshCorrelator.correlateDetailed(
            audioSamples: calibrationAudioSamples,
            sampleRate: sampleRate,
            meshFrames: calibrationMeshFrames,
            recordingDuration: duration
        )
        calibrationLagMs = lagResult.lagMs

        NSLog("[VoiceAttest] Calibration lag: %.0fms (pearson=%.3f at lag)", calibrationLagMs, lagResult.pearsonR)

        let result = CalibrationResult(
            lagMs: calibrationLagMs,
            meshFrames: calibrationMeshFrames,
            audioSamples: calibrationAudioSamples,
            durationMs: durationMs
        )

        // Transition to recording phase — keep audio engine + AR running
        // but restart speech recognition so calibration text doesn't leak
        recognitionTask?.cancel()
        recognitionTask = nil
        recognitionRequest?.endAudio()
        recognitionRequest = nil

        // Create fresh speech recognition for the recording phase
        let newRequest = SFSpeechAudioBufferRecognitionRequest()
        newRequest.requiresOnDeviceRecognition = true
        newRequest.shouldReportPartialResults = true
        recognitionRequest = newRequest

        if let sr = SFSpeechRecognizer(locale: Locale.current), sr.isAvailable {
            sr.supportsOnDeviceRecognition = true
            speechRecognizer = sr
            recognitionTask = sr.recognitionTask(with: newRequest) { [weak self] result, error in
                if let result {
                    let text = result.bestTranscription.formattedString
                    self?.currentTranscription = text
                    DispatchQueue.main.async {
                        self?.onTranscriptionUpdate?(text)
                    }
                }
                if let error {
                    NSLog("[VoiceAttest] Speech recognition error: %@", error.localizedDescription)
                }
            }
        }

        calibrationMeshFrames.removeAll()
        meshFrames.removeAll()
        audioSamples.removeAll()
        currentTranscription = ""
        lastMeshSampleTime = 0
        recordingStartTime = ProcessInfo.processInfo.systemUptime
        phase = .recording

        NSLog("[VoiceAttest] Transitioned to recording phase (speech recognizer restarted)")

        return result
    }

    // MARK: - Legacy start (skips calibration)

    func start() throws {
        guard phase == .idle else { return }
        try startCapture()
        phase = .recording
        NSLog("[VoiceAttest] Recording started (no calibration)")
    }

    // MARK: - Stop Recording

    func stop() -> Result {
        guard phase == .recording || phase == .calibrating else {
            return Result(transcription: "", audioHash: "", faceMeshFrames: [],
                          audioMeshCorrelation: AudioMeshCorrelation(score: 0, windowCount: 0, method: "multi-v2"),
                          inputSource: "unknown", audioDurationMs: 0, calibrationLagMs: 0)
        }

        let wasRecording = phase == .recording
        phase = .idle
        let duration = ProcessInfo.processInfo.systemUptime - recordingStartTime

        stopCapture()

        guard wasRecording else {
            return Result(transcription: "", audioHash: "", faceMeshFrames: [],
                          audioMeshCorrelation: AudioMeshCorrelation(score: 0, windowCount: 0, method: "multi-v2"),
                          inputSource: "unknown", audioDurationMs: 0, calibrationLagMs: 0)
        }

        NSLog("[VoiceAttest] Stopping: %d audio samples (rate=%.0f), %d mesh frames, duration=%.1fs",
              audioSamples.count, sampleRate, meshFrames.count, duration)

        // Log mesh frame timestamps and jawOpen values
        if !meshFrames.isEmpty {
            let jawValues = meshFrames.map { String(format: "%.2f", $0.jawOpen) }.joined(separator: ",")
            NSLog("[VoiceAttest] jawOpen values: [%@]", jawValues)
            let timestamps = meshFrames.map { String(format: "%.0f", $0.t) }.joined(separator: ",")
            NSLog("[VoiceAttest] mesh timestamps (ms): [%@]", timestamps)
        }

        // Compute audio hash
        let audioData = audioSamples.withUnsafeBufferPointer { ptr in
            Data(buffer: ptr)
        }
        let audioHash = CryptoEngine.sha256Base64URL(audioData)

        // Compute correlation with multi-feature analysis, using calibrated lag
        let correlation = AudioMeshCorrelator.correlate(
            audioSamples: audioSamples,
            sampleRate: sampleRate,
            meshFrames: meshFrames,
            recordingDuration: duration,
            calibratedLagMs: calibrationLagMs > 0 ? calibrationLagMs : nil
        )

        let inputSource = verifyInputSource(AVAudioSession.sharedInstance())

        let result = Result(
            transcription: currentTranscription,
            audioHash: audioHash,
            faceMeshFrames: meshFrames,
            audioMeshCorrelation: correlation,
            inputSource: inputSource,
            audioDurationMs: Int(duration * 1000),
            calibrationLagMs: calibrationLagMs
        )

        NSLog("[VoiceAttest] Recording stopped: %d mesh frames, score=%.3f (windows=%d), lag=%.0fms, duration=%.1fs, transcription='%@'",
              meshFrames.count, correlation.score, correlation.windowCount, calibrationLagMs, duration, currentTranscription)

        // Reset all state for next recording
        audioSamples.removeAll()
        meshFrames.removeAll()
        currentTranscription = ""
        lastMeshSampleTime = 0

        return result
    }

    // MARK: - ARSessionDelegate

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard phase == .calibrating || phase == .recording else { return }

        for anchor in anchors {
            guard let faceAnchor = anchor as? ARFaceAnchor else { continue }

            let now = (ProcessInfo.processInfo.systemUptime - recordingStartTime) * 1000  // ms
            guard now - lastMeshSampleTime >= meshSampleIntervalMs else { continue }
            lastMeshSampleTime = now

            let bs = faceAnchor.blendShapes
            let frame = FaceMeshFrame(
                t: now,
                jawOpen: bs[.jawOpen]?.floatValue ?? 0,
                mouthClose: bs[.mouthClose]?.floatValue ?? 0,
                mouthFunnel: bs[.mouthFunnel]?.floatValue ?? 0,
                mouthPucker: bs[.mouthPucker]?.floatValue ?? 0,
                mouthLeft: bs[.mouthLeft]?.floatValue ?? 0,
                mouthRight: bs[.mouthRight]?.floatValue ?? 0,
                mouthSmileLeft: bs[.mouthSmileLeft]?.floatValue ?? 0,
                mouthSmileRight: bs[.mouthSmileRight]?.floatValue ?? 0,
                mouthUpperUpLeft: bs[.mouthUpperUpLeft]?.floatValue ?? 0,
                mouthUpperUpRight: bs[.mouthUpperUpRight]?.floatValue ?? 0,
                mouthLowerDownLeft: bs[.mouthLowerDownLeft]?.floatValue ?? 0,
                mouthLowerDownRight: bs[.mouthLowerDownRight]?.floatValue ?? 0
            )

            if phase == .calibrating {
                calibrationMeshFrames.append(frame)
            } else {
                meshFrames.append(frame)
            }

            DispatchQueue.main.async { [weak self] in
                self?.onFaceTrackingUpdate?(faceAnchor.isTracked)
            }
        }
    }

    // MARK: - Helpers

    private func verifyInputSource(_ session: AVAudioSession) -> String {
        let inputs = session.currentRoute.inputs
        for input in inputs {
            if input.portType == .builtInMic {
                return "builtInMicrophone"
            }
        }
        return inputs.first?.portType.rawValue ?? "unknown"
    }
}

// MARK: - Errors

enum VoiceRecordingError: Error, LocalizedError {
    case speechRecognizerUnavailable
    case faceTrackingUnsupported
    case permissionDenied(String)

    var errorDescription: String? {
        switch self {
        case .speechRecognizerUnavailable:
            return "On-device speech recognition is not available."
        case .faceTrackingUnsupported:
            return "Face tracking requires iPhone X or later with TrueDepth camera."
        case .permissionDenied(let what):
            return "Permission denied: \(what)"
        }
    }
}
