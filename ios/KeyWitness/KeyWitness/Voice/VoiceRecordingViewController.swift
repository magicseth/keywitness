import UIKit
import ARKit
import SwiftUI

/// Full-screen voice recording view controller.
/// Shows the front camera with face tracking, real-time transcription,
/// and controls to record/stop/seal.
class VoiceRecordingViewController: UIViewController {

    // MARK: - State

    private let recordingSession = VoiceRecordingSession()
    private var arView: ARSCNView!
    private var transcriptionLabel: UILabel!
    private var statusLabel: UILabel!
    private var recordButton: UIButton!
    private var correlationLabel: UILabel!
    private var isRecording = false
    private var lastResult: VoiceRecordingSession.Result?

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()

        recordingSession.onTranscriptionUpdate = { [weak self] text in
            self?.transcriptionLabel.text = text.isEmpty ? "Start speaking..." : text
        }
        recordingSession.onFaceTrackingUpdate = { [weak self] tracked in
            self?.statusLabel.text = tracked ? "Face tracked" : "No face detected"
            self?.statusLabel.textColor = tracked ? .systemGreen : .systemOrange
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task {
            let perms = await VoiceRecordingSession.requestPermissions()
            if !perms.mic || !perms.speech || !perms.camera {
                statusLabel.text = "Permissions required: mic, speech, camera"
                statusLabel.textColor = .systemRed
                recordButton.isEnabled = false
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        if isRecording {
            _ = recordingSession.stop()
            isRecording = false
        }
        arView.session.pause()
    }

    // MARK: - UI Setup

    private func setupUI() {
        // AR view (front camera preview)
        arView = ARSCNView(frame: .zero)
        arView.session = recordingSession.arSession
        arView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(arView)

        // Dark overlay on camera
        let overlay = UIView()
        overlay.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        overlay.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(overlay)

        // Close button
        let closeButton = UIButton(type: .system)
        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = .white
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)

        // Status label
        statusLabel = UILabel()
        statusLabel.text = "Ready"
        statusLabel.textColor = .systemGray
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textAlignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        // Transcription label
        transcriptionLabel = UILabel()
        transcriptionLabel.text = "Tap record and speak"
        transcriptionLabel.textColor = .white
        transcriptionLabel.font = .systemFont(ofSize: 22, weight: .light)
        transcriptionLabel.textAlignment = .center
        transcriptionLabel.numberOfLines = 0
        transcriptionLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(transcriptionLabel)

        // Correlation label (shown after recording)
        correlationLabel = UILabel()
        correlationLabel.textColor = .systemGray
        correlationLabel.font = .systemFont(ofSize: 12)
        correlationLabel.textAlignment = .center
        correlationLabel.translatesAutoresizingMaskIntoConstraints = false
        correlationLabel.isHidden = true
        view.addSubview(correlationLabel)

        // Record button
        recordButton = UIButton(type: .system)
        recordButton.translatesAutoresizingMaskIntoConstraints = false
        updateRecordButton()
        recordButton.addTarget(self, action: #selector(recordTapped), for: .touchUpInside)
        view.addSubview(recordButton)

        NSLayoutConstraint.activate([
            arView.topAnchor.constraint(equalTo: view.topAnchor),
            arView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            arView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            arView.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.5),

            overlay.topAnchor.constraint(equalTo: arView.topAnchor),
            overlay.leadingAnchor.constraint(equalTo: arView.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: arView.trailingAnchor),
            overlay.bottomAnchor.constraint(equalTo: arView.bottomAnchor),

            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            closeButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            closeButton.widthAnchor.constraint(equalToConstant: 32),
            closeButton.heightAnchor.constraint(equalToConstant: 32),

            statusLabel.topAnchor.constraint(equalTo: arView.bottomAnchor, constant: 16),
            statusLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),

            transcriptionLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 20),
            transcriptionLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            transcriptionLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),

            correlationLabel.topAnchor.constraint(equalTo: transcriptionLabel.bottomAnchor, constant: 12),
            correlationLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            correlationLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),

            recordButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            recordButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            recordButton.widthAnchor.constraint(equalToConstant: 200),
            recordButton.heightAnchor.constraint(equalToConstant: 50),
        ])
    }

    private func updateRecordButton() {
        if lastResult != nil && !isRecording {
            // Show "Seal" button after recording
            recordButton.setTitle("Seal", for: .normal)
            recordButton.setTitleColor(.white, for: .normal)
            recordButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
            recordButton.backgroundColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1)
            recordButton.layer.cornerRadius = 12
        } else if isRecording {
            recordButton.setTitle("Stop", for: .normal)
            recordButton.setTitleColor(.white, for: .normal)
            recordButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
            recordButton.backgroundColor = .systemRed
            recordButton.layer.cornerRadius = 12
        } else {
            recordButton.setTitle("Record", for: .normal)
            recordButton.setTitleColor(.white, for: .normal)
            recordButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
            recordButton.backgroundColor = .systemRed
            recordButton.layer.cornerRadius = 12
        }
    }

    // MARK: - Actions

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    @objc private func recordTapped() {
        if lastResult != nil && !isRecording {
            // Seal
            seal()
        } else if isRecording {
            // Stop
            let result = recordingSession.stop()
            isRecording = false
            lastResult = result

            correlationLabel.isHidden = false
            let scoreText = String(format: "%.0f%%", result.audioMeshCorrelation.score * 100)
            correlationLabel.text = "Liveness: \(scoreText) correlation · \(result.faceMeshFrames.count) face frames · \(result.audioDurationMs)ms"
            statusLabel.text = "Ready to seal"
            updateRecordButton()
        } else {
            // Start
            do {
                lastResult = nil
                correlationLabel.isHidden = true
                try recordingSession.start()
                isRecording = true
                transcriptionLabel.text = "Start speaking..."
                statusLabel.text = "Recording..."
                statusLabel.textColor = .systemRed
                updateRecordButton()
            } catch {
                statusLabel.text = error.localizedDescription
                statusLabel.textColor = .systemRed
            }
        }
    }

    // MARK: - Seal (Build VC + Upload)

    private func seal() {
        guard let result = lastResult, !result.transcription.isEmpty else {
            statusLabel.text = "No speech detected"
            statusLabel.textColor = .systemOrange
            return
        }

        statusLabel.text = "Sealing..."
        statusLabel.textColor = .systemBlue
        recordButton.isEnabled = false

        Task {
            do {
                // Read App Attest session
                let defaults = UserDefaults(suiteName: "group.io.keywitness")
                let sessionKeyId = defaults?.string(forKey: "appAttestSessionKeyId")
                let sessionAssertion = defaults?.string(forKey: "appAttestSessionAssertion")
                let sessionClientData = defaults?.string(forKey: "appAttestSessionClientData")
                let sessionValid = sessionAssertion != nil

                let (attestationBlock, encryptionKey) = try VoiceVCBuilder.createVC(
                    cleartext: result.transcription,
                    audioHash: result.audioHash,
                    faceMeshFrames: result.faceMeshFrames,
                    audioMeshCorrelation: result.audioMeshCorrelation,
                    faceIdVerified: false,
                    inputSource: result.inputSource,
                    audioDurationMs: result.audioDurationMs,
                    appAttestKeyId: sessionValid ? sessionKeyId : nil,
                    appAttestAssertion: sessionValid ? sessionAssertion : nil,
                    appAttestClientData: sessionValid ? sessionClientData : nil
                )

                // Upload
                let uploadResult = try await upload(attestationBlock)
                let fragment = EmojiKey.encode(encryptionKey) ?? encryptionKey
                let fullURL = uploadResult.url + "#" + fragment

                await MainActor.run {
                    statusLabel.text = "Sealed!"
                    statusLabel.textColor = .systemGreen
                    transcriptionLabel.text = fullURL

                    // Copy to clipboard
                    UIPasteboard.general.string = fullURL
                    correlationLabel.text = "Link copied to clipboard"
                    correlationLabel.isHidden = false
                    recordButton.isEnabled = true
                    lastResult = nil
                    updateRecordButton()
                }
            } catch {
                await MainActor.run {
                    statusLabel.text = "Error: \(error.localizedDescription)"
                    statusLabel.textColor = .systemRed
                    recordButton.isEnabled = true
                }
            }
        }
    }

    // MARK: - Upload

    private struct UploadResponse {
        let url: String
        let id: String
    }

    private func upload(_ attestationBlock: String) async throws -> UploadResponse {
        let endpoint = "https://www.keywitness.io/api/attestations"
        guard let url = URL(string: endpoint) else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = ["attestation": attestationBlock]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            throw URLError(.badServerResponse)
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let attestationURL = json["url"] as? String,
              let shortId = json["id"] as? String else {
            throw URLError(.cannotParseResponse)
        }

        return UploadResponse(url: attestationURL, id: shortId)
    }
}
