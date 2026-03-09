import UIKit
import ARKit
import SwiftUI

/// Full-screen voice recording view controller.
/// Shows the front camera with face tracking, real-time transcription,
/// and controls to record/stop/seal.
class VoiceRecordingViewController: UIViewController, ARSCNViewDelegate {

    // MARK: - State

    private let recordingSession = VoiceRecordingSession()
    private var arView: ARSCNView!
    private var faceGeometryNode: SCNNode?
    private var transcriptionLabel: UILabel!
    private var statusLabel: UILabel!
    private var recordButton: UIButton!
    private var cancelButton: UIButton!
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
        // AR view (front camera preview with face mesh overlay)
        arView = ARSCNView(frame: .zero)
        arView.session = recordingSession.arSession
        arView.delegate = self
        arView.automaticallyUpdatesLighting = true
        arView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(arView)

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

        // Button stack (cancel + record/seal)
        cancelButton = UIButton(type: .system)
        cancelButton.translatesAutoresizingMaskIntoConstraints = false
        cancelButton.setTitle("Cancel", for: .normal)
        cancelButton.setTitleColor(.white, for: .normal)
        cancelButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        cancelButton.backgroundColor = UIColor.white.withAlphaComponent(0.15)
        cancelButton.layer.cornerRadius = 12
        cancelButton.isHidden = true
        cancelButton.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)
        view.addSubview(cancelButton)

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

            cancelButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            cancelButton.trailingAnchor.constraint(equalTo: view.centerXAnchor, constant: -8),
            cancelButton.widthAnchor.constraint(equalToConstant: 140),
            cancelButton.heightAnchor.constraint(equalToConstant: 50),

            recordButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            recordButton.leadingAnchor.constraint(equalTo: view.centerXAnchor, constant: 8),
            recordButton.widthAnchor.constraint(equalToConstant: 140),
            recordButton.heightAnchor.constraint(equalToConstant: 50),
        ])
    }

    private func updateRecordButton() {
        if lastResult != nil && !isRecording {
            // Show "Seal" button with checkmark badge + cancel button
            let attachment = NSTextAttachment()
            attachment.image = UIImage(systemName: "checkmark.seal.fill")?.withTintColor(.white, renderingMode: .alwaysOriginal)
            let imageString = NSAttributedString(attachment: attachment)
            let title = NSMutableAttributedString(attributedString: imageString)
            title.append(NSAttributedString(string: " Seal", attributes: [
                .foregroundColor: UIColor.white,
                .font: UIFont.systemFont(ofSize: 18, weight: .semibold),
            ]))
            recordButton.setAttributedTitle(title, for: .normal)
            recordButton.backgroundColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1)
            recordButton.layer.cornerRadius = 12
            cancelButton.isHidden = false
        } else if isRecording {
            recordButton.setAttributedTitle(nil, for: .normal)
            recordButton.setTitle("Stop", for: .normal)
            recordButton.setTitleColor(.white, for: .normal)
            recordButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
            recordButton.backgroundColor = .systemRed
            recordButton.layer.cornerRadius = 12
            cancelButton.isHidden = true
        } else {
            recordButton.setAttributedTitle(nil, for: .normal)
            recordButton.setTitle("Record", for: .normal)
            recordButton.setTitleColor(.white, for: .normal)
            recordButton.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
            recordButton.backgroundColor = .systemRed
            recordButton.layer.cornerRadius = 12
            cancelButton.isHidden = true
        }
    }

    // MARK: - Actions

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    @objc private func cancelTapped() {
        lastResult = nil
        transcriptionLabel.text = "Tap record and speak"
        correlationLabel.isHidden = true
        statusLabel.text = "Ready"
        statusLabel.textColor = .systemGray
        updateRecordButton()
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

    // MARK: - ARSCNViewDelegate (Face Mesh Overlay)

    func renderer(_ renderer: SCNSceneRenderer, nodeFor anchor: ARAnchor) -> SCNNode? {
        guard let faceAnchor = anchor as? ARFaceAnchor else { return nil }
        let faceGeometry = ARSCNFaceGeometry(device: arView.device!)!
        faceGeometry.firstMaterial?.fillMode = .lines
        faceGeometry.firstMaterial?.diffuse.contents = UIColor(red: 0.2, green: 0.8, blue: 1.0, alpha: 0.7)
        faceGeometry.firstMaterial?.isDoubleSided = true
        let node = SCNNode(geometry: faceGeometry)
        faceGeometryNode = node
        faceGeometry.update(from: faceAnchor.geometry)
        return node
    }

    func renderer(_ renderer: SCNSceneRenderer, didUpdate node: SCNNode, for anchor: ARAnchor) {
        guard let faceAnchor = anchor as? ARFaceAnchor,
              let faceGeometry = node.geometry as? ARSCNFaceGeometry else { return }
        faceGeometry.update(from: faceAnchor.geometry)
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

                    // Copy text + URL to clipboard
                    UIPasteboard.general.string = "\(result.transcription)\n\n\(fullURL)"
                    correlationLabel.text = "Text + link copied to clipboard"
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
        guard let httpResponse = response as? HTTPURLResponse else {
            throw URLError(.badServerResponse)
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            NSLog("[VoiceAttest] Upload failed: HTTP %d — %@", httpResponse.statusCode, body)
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
