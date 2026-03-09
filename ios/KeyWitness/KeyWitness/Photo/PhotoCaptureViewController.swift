import UIKit
import AVFoundation
import Photos

/// Full-screen camera view for photo attestation.
///
/// Flow:
/// 1. Live camera preview
/// 2. Tap capture button → take photo
/// 3. Review: show photo + "Seal" / "Retake" buttons
/// 4. Seal → build VC, embed XMP, upload, save to photo library
class PhotoCaptureViewController: UIViewController {

    // MARK: - State

    private let captureSession = PhotoCaptureSession()
    private var previewLayer: AVCaptureVideoPreviewLayer!
    private var captureResult: PhotoCaptureResult?
    private var previewImageView: UIImageView!
    private var captureButton: UIButton!
    private var sealButton: UIButton!
    private var retakeButton: UIButton!
    private var statusLabel: UILabel!

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        setupUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task {
            let granted = await PhotoCaptureSession.requestPermissions()
            if !granted {
                statusLabel.text = "Camera permission required"
                statusLabel.textColor = .systemRed
                captureButton.isEnabled = false
                return
            }
            do {
                try captureSession.configure()
                previewLayer.session = captureSession.captureSession
                captureSession.start()
            } catch {
                statusLabel.text = error.localizedDescription
                statusLabel.textColor = .systemRed
            }
        }
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        captureSession.stop()
    }

    // MARK: - UI Setup

    private func setupUI() {
        // Camera preview
        previewLayer = AVCaptureVideoPreviewLayer()
        previewLayer.videoGravity = .resizeAspectFill
        previewLayer.frame = view.bounds
        view.layer.addSublayer(previewLayer)

        // Preview image (shown after capture)
        previewImageView = UIImageView()
        previewImageView.contentMode = .scaleAspectFill
        previewImageView.clipsToBounds = true
        previewImageView.isHidden = true
        previewImageView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(previewImageView)

        // Close button
        let closeButton = UIButton(type: .system)
        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = .white
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)

        // Status label
        statusLabel = UILabel()
        statusLabel.text = "Take a photo to attest"
        statusLabel.textColor = .white
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textAlignment = .center
        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(statusLabel)

        // Capture button (large circle)
        captureButton = UIButton(type: .custom)
        captureButton.translatesAutoresizingMaskIntoConstraints = false
        captureButton.addTarget(self, action: #selector(captureTapped), for: .touchUpInside)
        let outerCircle = UIView()
        outerCircle.backgroundColor = .clear
        outerCircle.layer.borderColor = UIColor.white.cgColor
        outerCircle.layer.borderWidth = 3
        outerCircle.layer.cornerRadius = 35
        outerCircle.isUserInteractionEnabled = false
        outerCircle.translatesAutoresizingMaskIntoConstraints = false
        let innerCircle = UIView()
        innerCircle.backgroundColor = .white
        innerCircle.layer.cornerRadius = 28
        innerCircle.isUserInteractionEnabled = false
        innerCircle.translatesAutoresizingMaskIntoConstraints = false
        captureButton.addSubview(outerCircle)
        outerCircle.addSubview(innerCircle)
        view.addSubview(captureButton)

        // Seal button (hidden initially)
        sealButton = UIButton(type: .system)
        sealButton.setTitle("  Seal", for: .normal)
        sealButton.setImage(UIImage(systemName: "checkmark.seal.fill"), for: .normal)
        sealButton.tintColor = .white
        sealButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        sealButton.backgroundColor = .systemBlue
        sealButton.layer.cornerRadius = 12
        sealButton.translatesAutoresizingMaskIntoConstraints = false
        sealButton.isHidden = true
        sealButton.addTarget(self, action: #selector(sealTapped), for: .touchUpInside)
        view.addSubview(sealButton)

        // Retake button (hidden initially)
        retakeButton = UIButton(type: .system)
        retakeButton.setTitle("Retake", for: .normal)
        retakeButton.tintColor = .white
        retakeButton.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        retakeButton.backgroundColor = UIColor.white.withAlphaComponent(0.2)
        retakeButton.layer.cornerRadius = 12
        retakeButton.translatesAutoresizingMaskIntoConstraints = false
        retakeButton.isHidden = true
        retakeButton.addTarget(self, action: #selector(retakeTapped), for: .touchUpInside)
        view.addSubview(retakeButton)

        NSLayoutConstraint.activate([
            // Preview image
            previewImageView.topAnchor.constraint(equalTo: view.topAnchor),
            previewImageView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            previewImageView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            previewImageView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            // Close button
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            closeButton.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            closeButton.widthAnchor.constraint(equalToConstant: 36),
            closeButton.heightAnchor.constraint(equalToConstant: 36),

            // Status label
            statusLabel.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -100),
            statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),

            // Capture button
            captureButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            captureButton.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            captureButton.widthAnchor.constraint(equalToConstant: 70),
            captureButton.heightAnchor.constraint(equalToConstant: 70),

            // Outer circle
            outerCircle.centerXAnchor.constraint(equalTo: captureButton.centerXAnchor),
            outerCircle.centerYAnchor.constraint(equalTo: captureButton.centerYAnchor),
            outerCircle.widthAnchor.constraint(equalToConstant: 70),
            outerCircle.heightAnchor.constraint(equalToConstant: 70),

            // Inner circle
            innerCircle.centerXAnchor.constraint(equalTo: outerCircle.centerXAnchor),
            innerCircle.centerYAnchor.constraint(equalTo: outerCircle.centerYAnchor),
            innerCircle.widthAnchor.constraint(equalToConstant: 56),
            innerCircle.heightAnchor.constraint(equalToConstant: 56),

            // Seal button
            sealButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            sealButton.trailingAnchor.constraint(equalTo: view.centerXAnchor, constant: -8),
            sealButton.widthAnchor.constraint(equalToConstant: 140),
            sealButton.heightAnchor.constraint(equalToConstant: 50),

            // Retake button
            retakeButton.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -30),
            retakeButton.leadingAnchor.constraint(equalTo: view.centerXAnchor, constant: 8),
            retakeButton.widthAnchor.constraint(equalToConstant: 140),
            retakeButton.heightAnchor.constraint(equalToConstant: 50),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer.frame = view.bounds
    }

    // MARK: - Actions

    @objc private func closeTapped() {
        captureSession.stop()
        dismiss(animated: true)
    }

    @objc private func captureTapped() {
        captureButton.isEnabled = false
        statusLabel.text = "Capturing..."

        captureSession.capturePhoto { [weak self] result in
            DispatchQueue.main.async {
                guard let self else { return }
                switch result {
                case .success(let captureResult):
                    self.captureResult = captureResult
                    self.showPreview(captureResult)
                case .failure(let error):
                    self.statusLabel.text = "Error: \(error.localizedDescription)"
                    self.statusLabel.textColor = .systemRed
                    self.captureButton.isEnabled = true
                }
            }
        }
    }

    @objc private func retakeTapped() {
        captureResult = nil
        previewImageView.isHidden = true
        previewImageView.image = nil
        captureButton.isHidden = false
        sealButton.isHidden = true
        retakeButton.isHidden = true
        statusLabel.text = "Take a photo to attest"
        statusLabel.textColor = .white
        captureButton.isEnabled = true
        captureSession.start()
    }

    @objc private func sealTapped() {
        guard let result = captureResult else { return }
        seal(result)
    }

    // MARK: - Preview

    private func showPreview(_ result: PhotoCaptureResult) {
        captureSession.stop()

        previewImageView.image = UIImage(data: result.imageData)
        previewImageView.isHidden = false
        captureButton.isHidden = true
        sealButton.isHidden = false
        retakeButton.isHidden = false

        let sizeStr = ByteCountFormatter.string(fromByteCount: Int64(result.imageData.count), countStyle: .file)
        statusLabel.text = "\(result.width)×\(result.height) · \(sizeStr)"
        statusLabel.textColor = .white
    }

    // MARK: - Seal

    private func seal(_ result: PhotoCaptureResult) {
        statusLabel.text = "Sealing..."
        statusLabel.textColor = .systemBlue
        sealButton.isEnabled = false
        retakeButton.isEnabled = false

        Task {
            do {
                let defaults = UserDefaults(suiteName: "group.io.keywitness")
                let sessionKeyId = defaults?.string(forKey: "appAttestSessionKeyId")
                let sessionAssertion = defaults?.string(forKey: "appAttestSessionAssertion")
                let sessionClientData = defaults?.string(forKey: "appAttestSessionClientData")
                let sessionValid = sessionAssertion != nil

                let (attestationBlock, encryptionKey, signedImageData) = try PhotoVCBuilder.createVC(
                    captureResult: result,
                    faceIdVerified: false,
                    appAttestKeyId: sessionValid ? sessionKeyId : nil,
                    appAttestAssertion: sessionValid ? sessionAssertion : nil,
                    appAttestClientData: sessionValid ? sessionClientData : nil
                )

                let uploadResult = try await upload(attestationBlock)
                let fragment = EmojiKey.encode(encryptionKey) ?? encryptionKey
                let fullURL = uploadResult.url + "#" + fragment

                // Add verification URL to the signed image's XMP
                let finalImageData = PhotoVCBuilder.addVerificationURL(to: signedImageData, url: fullURL) ?? signedImageData

                // Save attested photo to library
                saveToPhotoLibrary(finalImageData)

                await MainActor.run {
                    statusLabel.text = "Sealed! Photo saved."
                    statusLabel.textColor = .systemGreen

                    UIPasteboard.general.string = fullURL
                    NSLog("[PhotoAttest] Sealed: %@", fullURL)

                    // Show URL briefly then dismiss
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
                        self?.dismiss(animated: true)
                    }
                }
            } catch {
                NSLog("[PhotoAttest] Seal error: %@", error.localizedDescription)
                await MainActor.run {
                    statusLabel.text = "Error: \(error.localizedDescription)"
                    statusLabel.textColor = .systemRed
                    sealButton.isEnabled = true
                    retakeButton.isEnabled = true
                }
            }
        }
    }

    // MARK: - Save to Photo Library

    private func saveToPhotoLibrary(_ imageData: Data) {
        PHPhotoLibrary.requestAuthorization(for: .addOnly) { status in
            guard status == .authorized else {
                NSLog("[PhotoAttest] Photo library access denied")
                return
            }
            PHPhotoLibrary.shared().performChanges {
                let request = PHAssetCreationRequest.forAsset()
                request.addResource(with: .photo, data: imageData, options: nil)
            } completionHandler: { success, error in
                if success {
                    NSLog("[PhotoAttest] Photo saved to library with XMP attestation")
                } else if let error {
                    NSLog("[PhotoAttest] Failed to save: %@", error.localizedDescription)
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
        guard let url = URL(string: endpoint) else { throw URLError(.badURL) }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = ["attestation": attestationBlock]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200...299).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            NSLog("[PhotoAttest] Upload failed: %@", body)
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
