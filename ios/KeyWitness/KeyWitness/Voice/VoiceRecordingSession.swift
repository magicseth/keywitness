import Foundation
import AVFoundation
import Speech
import ARKit
import CryptoKit

/// Orchestrates concurrent audio capture, on-device speech recognition,
/// and ARKit face mesh tracking for voice attestation.
///
/// Usage:
///   let session = VoiceRecordingSession()
///   try await session.start()
///   // ... user speaks ...
///   let result = await session.stop()
final class VoiceRecordingSession: NSObject, ARSessionDelegate {

    // MARK: - Result

    struct Result {
        let transcription: String
        let audioHash: String           // SHA-256 of raw PCM, base64url
        let faceMeshFrames: [FaceMeshFrame]
        let audioMeshCorrelation: AudioMeshCorrelation
        let inputSource: String         // e.g. "builtInMicrophone"
        let audioDurationMs: Int
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
    private let meshSampleIntervalMs: TimeInterval = 100  // 10 Hz

    private var currentTranscription = ""
    private var isRecording = false

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

        // Camera permission is requested by ARKit automatically when the session starts.
        // We check current status here.
        let camera = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
            || await AVCaptureDevice.requestAccess(for: .video)

        return (mic, speech, camera)
    }

    // MARK: - Start Recording

    func start() throws {
        guard !isRecording else { return }

        // Verify microphone input source
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.record, mode: .measurement)
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

        // Start recognition
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
            // Feed to speech recognizer
            self?.recognitionRequest?.append(buffer)

            // Collect raw samples for correlation + hashing
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameCount = Int(buffer.frameLength)
            let samples = Array(UnsafeBufferPointer(start: channelData, count: frameCount))
            self?.audioSamples.append(contentsOf: samples)
        }

        try audioEngine.start()

        // Start ARKit face tracking
        guard ARFaceTrackingConfiguration.isSupported else {
            throw VoiceRecordingError.faceTrackingUnsupported
        }
        let arConfig = ARFaceTrackingConfiguration()
        arConfig.isLightEstimationEnabled = false
        arSession.delegate = self
        arSession.run(arConfig)

        recordingStartTime = ProcessInfo.processInfo.systemUptime
        isRecording = true
        NSLog("[VoiceAttest] Recording started")
    }

    // MARK: - Stop Recording

    func stop() -> Result {
        guard isRecording else {
            return Result(transcription: "", audioHash: "", faceMeshFrames: [],
                          audioMeshCorrelation: AudioMeshCorrelation(score: 0, windowCount: 0, method: "energy-jawopen-v1"),
                          inputSource: "unknown", audioDurationMs: 0)
        }

        isRecording = false
        let duration = ProcessInfo.processInfo.systemUptime - recordingStartTime

        // Stop audio
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()

        // Stop ARKit
        arSession.pause()

        // Compute audio hash
        let audioData = audioSamples.withUnsafeBufferPointer { ptr in
            Data(buffer: ptr)
        }
        let audioHash = CryptoEngine.sha256Base64URL(audioData)

        // Compute correlation
        let correlation = AudioMeshCorrelator.correlate(
            audioSamples: audioSamples,
            sampleRate: sampleRate,
            meshFrames: meshFrames,
            recordingDuration: duration
        )

        // Get input source
        let inputSource = verifyInputSource(AVAudioSession.sharedInstance())

        let result = Result(
            transcription: currentTranscription,
            audioHash: audioHash,
            faceMeshFrames: meshFrames,
            audioMeshCorrelation: correlation,
            inputSource: inputSource,
            audioDurationMs: Int(duration * 1000)
        )

        NSLog("[VoiceAttest] Recording stopped: %d mesh frames, correlation=%.3f, duration=%.1fs",
              meshFrames.count, correlation.score, duration)

        // Reset
        audioSamples.removeAll()
        meshFrames.removeAll()
        currentTranscription = ""

        return result
    }

    // MARK: - ARSessionDelegate

    func session(_ session: ARSession, didUpdate anchors: [ARAnchor]) {
        guard isRecording else { return }

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
                mouthUpperUpLeft: bs[.mouthUpperUp_L]?.floatValue ?? 0,
                mouthUpperUpRight: bs[.mouthUpperUp_R]?.floatValue ?? 0,
                mouthLowerDownLeft: bs[.mouthLowerDown_L]?.floatValue ?? 0,
                mouthLowerDownRight: bs[.mouthLowerDown_R]?.floatValue ?? 0
            )
            meshFrames.append(frame)

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
