import UIKit
import LocalAuthentication
import UserNotifications

/// Container app main screen. Shows setup instructions, the device public key,
/// and a test text field to try the KeyWitness keyboard.
/// Also handles biometric verification requests from the keyboard extension.
class MainViewController: UIViewController {

    // MARK: - UI Elements

    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()
    private let instructionsCard = UIView()
    private let instructionsLabel = UILabel()
    private let publicKeyHeader = UILabel()
    private let publicKeyLabel = UILabel()
    private let copyKeyButton = UIButton(type: .system)
    private let registerKeyButton = UIButton(type: .system)
    private let testHeader = UILabel()
    private let testTextView = UITextView()
    private let biometricStatusLabel = UILabel()

    // MARK: - Colors

    private let bgColor = UIColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1.0)
    private let cardColor = UIColor(red: 0.12, green: 0.12, blue: 0.14, alpha: 1.0)
    private let accentColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1.0)

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        loadPublicKey()
        requestNotificationPermission()

        // Set ourselves as the notification delegate to handle taps
        UNUserNotificationCenter.current().delegate = self

        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillShow(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        checkPendingBiometric()
    }

    @objc private func appDidBecomeActive() {
        checkPendingBiometric()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Pending Biometric Check

    /// Called when app becomes active — checks if a keyboard attestation needs Face ID.
    private func checkPendingBiometric() {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        guard let shortId = defaults?.string(forKey: "pendingBiometricShortId"),
              let createdAt = defaults?.object(forKey: "pendingBiometricCreatedAt") as? Date else {
            return
        }

        // Check 60-second window
        let age = Date().timeIntervalSince(createdAt)
        if age > 60 {
            // Expired — clean up
            defaults?.removeObject(forKey: "pendingBiometricShortId")
            defaults?.removeObject(forKey: "pendingBiometricCreatedAt")
            return
        }

        // Consume immediately so we don't re-trigger
        defaults?.removeObject(forKey: "pendingBiometricShortId")
        defaults?.removeObject(forKey: "pendingBiometricCreatedAt")

        // Trigger Face ID
        performBiometricVerification(shortId: shortId)
    }

    // MARK: - Biometric Verification Flow

    private func performBiometricVerification(shortId: String) {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            updateBiometricStatus("Biometrics unavailable", color: .systemRed)
            return
        }

        updateBiometricStatus("Verifying identity...", color: .systemYellow)

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: "Verify your identity for attestation \(shortId)") { [weak self] success, _ in
            DispatchQueue.main.async {
                if success {
                    self?.uploadBiometricSignature(shortId: shortId)
                } else {
                    self?.updateBiometricStatus("Verification cancelled", color: .systemRed)
                    self?.clearBiometricStatusAfterDelay()
                }
            }
        }
    }

    private func uploadBiometricSignature(shortId: String) {
        updateBiometricStatus("Signing...", color: .systemYellow)

        do {
            let challenge = "keywitness:biometric:\(shortId)"
            guard let data = challenge.data(using: .utf8) else {
                throw CryptoEngineError.encryptionFailed
            }
            let signature = try CryptoEngine.signBase64URL(data)
            let publicKey = try CryptoEngine.publicKeyBase64URL()

            let url = URL(string: "https://www.keywitness.io/api/attestations/verify-biometric")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")

            let payload: [String: String] = [
                "shortId": shortId,
                "signature": signature,
                "publicKey": publicKey,
            ]
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)

            URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                DispatchQueue.main.async {
                    if let httpResponse = response as? HTTPURLResponse,
                       httpResponse.statusCode == 200, error == nil {
                        self?.updateBiometricStatus("✓ Biometric verified for \(shortId)", color: .systemGreen)
                    } else {
                        var msg = "Upload failed"
                        if let data = data,
                           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                           let errorMsg = json["error"] as? String {
                            msg = errorMsg
                        }
                        self?.updateBiometricStatus(msg, color: .systemRed)
                    }
                    self?.clearBiometricStatusAfterDelay()
                }
            }.resume()
        } catch {
            updateBiometricStatus("Signing error: \(error.localizedDescription)", color: .systemRed)
            clearBiometricStatusAfterDelay()
        }
    }

    private func updateBiometricStatus(_ text: String, color: UIColor) {
        biometricStatusLabel.text = text
        biometricStatusLabel.textColor = color
        biometricStatusLabel.isHidden = false
    }

    private func clearBiometricStatusAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
            self?.biometricStatusLabel.isHidden = true
        }
    }

    // MARK: - Keyboard Handling

    @objc private func keyboardWillShow(_ notification: Notification) {
        guard let frame = notification.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? CGRect,
              let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double else { return }
        let inset = frame.height - view.safeAreaInsets.bottom
        UIView.animate(withDuration: duration) {
            self.scrollView.contentInset.bottom = inset
            self.scrollView.verticalScrollIndicatorInsets.bottom = inset
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            let rect = self.testTextView.convert(self.testTextView.bounds, to: self.scrollView)
            self.scrollView.scrollRectToVisible(rect.insetBy(dx: 0, dy: -20), animated: true)
        }
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        guard let duration = notification.userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double else { return }
        UIView.animate(withDuration: duration) {
            self.scrollView.contentInset.bottom = 0
            self.scrollView.verticalScrollIndicatorInsets.bottom = 0
        }
    }

    // MARK: - UI Setup

    private func setupUI() {
        view.backgroundColor = bgColor

        // Scroll view
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])

        // Content stack
        contentStack.axis = .vertical
        contentStack.spacing = 24
        contentStack.alignment = .fill
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
        NSLayoutConstraint.activate([
            contentStack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 32),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 24),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -24),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -32),
            contentStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -48)
        ])

        // Title
        titleLabel.text = "KeyWitness"
        titleLabel.font = UIFont.systemFont(ofSize: 34, weight: .bold)
        titleLabel.textColor = .white
        titleLabel.textAlignment = .center
        contentStack.addArrangedSubview(titleLabel)

        // Subtitle
        subtitleLabel.text = "Cryptographic Keyboard"
        subtitleLabel.font = UIFont.systemFont(ofSize: 17, weight: .regular)
        subtitleLabel.textColor = UIColor.lightGray
        subtitleLabel.textAlignment = .center
        contentStack.addArrangedSubview(subtitleLabel)

        // Biometric status (hidden by default)
        biometricStatusLabel.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        biometricStatusLabel.textAlignment = .center
        biometricStatusLabel.numberOfLines = 0
        biometricStatusLabel.isHidden = true
        contentStack.addArrangedSubview(biometricStatusLabel)

        // Instructions card
        setupInstructionsCard()

        // Public key section
        setupPublicKeySection()

        // Test field section
        setupTestField()
    }

    private func setupInstructionsCard() {
        instructionsCard.backgroundColor = cardColor
        instructionsCard.layer.cornerRadius = 12
        instructionsCard.translatesAutoresizingMaskIntoConstraints = false
        contentStack.addArrangedSubview(instructionsCard)

        let header = UILabel()
        header.text = "Setup"
        header.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        header.textColor = .white

        instructionsLabel.numberOfLines = 0
        instructionsLabel.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        instructionsLabel.textColor = UIColor.lightGray
        instructionsLabel.text = """
        1. Open Settings > General > Keyboard > Keyboards
        2. Tap "Add New Keyboard..."
        3. Select "KeyWitness" from the list
        4. Enable "Allow Full Access" for network features
        5. Switch to the KeyWitness keyboard in any app
        6. Type your message, then tap "Attest" to sign it

        After attesting, you'll get a notification to verify with Face ID. Tap the notification within 30 seconds to add biometric proof to your attestation.
        """

        let stack = UIStackView(arrangedSubviews: [header, instructionsLabel])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        instructionsCard.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: instructionsCard.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: instructionsCard.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: instructionsCard.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: instructionsCard.bottomAnchor, constant: -16)
        ])
    }

    private func setupPublicKeySection() {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        contentStack.addArrangedSubview(card)

        publicKeyHeader.text = "Your Public Key"
        publicKeyHeader.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        publicKeyHeader.textColor = .white

        publicKeyLabel.numberOfLines = 0
        publicKeyLabel.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        publicKeyLabel.textColor = accentColor
        publicKeyLabel.text = "Loading..."
        publicKeyLabel.textAlignment = .center

        copyKeyButton.setTitle("Copy Public Key", for: .normal)
        copyKeyButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        copyKeyButton.tintColor = accentColor
        copyKeyButton.addTarget(self, action: #selector(copyPublicKey), for: .touchUpInside)

        registerKeyButton.setTitle("Register Key", for: .normal)
        registerKeyButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        registerKeyButton.tintColor = accentColor
        registerKeyButton.addTarget(self, action: #selector(registerPublicKey), for: .touchUpInside)

        let description = UILabel()
        description.text = "Share this key to let others verify your attestations."
        description.font = UIFont.systemFont(ofSize: 13, weight: .regular)
        description.textColor = UIColor.lightGray
        description.textAlignment = .center
        description.numberOfLines = 0

        let stack = UIStackView(arrangedSubviews: [publicKeyHeader, publicKeyLabel, copyKeyButton, registerKeyButton, description])
        stack.axis = .vertical
        stack.spacing = 12
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16)
        ])
    }

    private func setupTestField() {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 12
        card.translatesAutoresizingMaskIntoConstraints = false
        contentStack.addArrangedSubview(card)

        testHeader.text = "Test Keyboard"
        testHeader.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        testHeader.textColor = .white

        testTextView.font = UIFont.systemFont(ofSize: 15)
        testTextView.textColor = .white
        testTextView.backgroundColor = UIColor(red: 0.18, green: 0.18, blue: 0.20, alpha: 1.0)
        testTextView.layer.cornerRadius = 8
        testTextView.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        testTextView.isScrollEnabled = true
        testTextView.text = "Tap here and switch to KeyWitness keyboard..."
        testTextView.textColor = .gray
        testTextView.delegate = self
        testTextView.heightAnchor.constraint(greaterThanOrEqualToConstant: 150).isActive = true

        let stack = UIStackView(arrangedSubviews: [testHeader, testTextView])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16)
        ])
    }

    // MARK: - Public Key

    private func loadPublicKey() {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let pubKey = try CryptoEngine.publicKeyBase64URL()
                DispatchQueue.main.async {
                    self.publicKeyLabel.text = pubKey
                }
            } catch {
                DispatchQueue.main.async {
                    self.publicKeyLabel.text = "Error: \(error.localizedDescription)"
                    self.publicKeyLabel.textColor = .systemRed
                }
            }
        }
    }

    @objc private func copyPublicKey() {
        guard let key = publicKeyLabel.text, !key.starts(with: "Error"), !key.starts(with: "Loading") else {
            return
        }
        UIPasteboard.general.string = key

        let original = copyKeyButton.title(for: .normal)
        copyKeyButton.setTitle("Copied!", for: .normal)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            self.copyKeyButton.setTitle(original, for: .normal)
        }
    }

    @objc private func registerPublicKey() {
        guard let key = publicKeyLabel.text, !key.starts(with: "Error"), !key.starts(with: "Loading") else {
            return
        }

        let alert = UIAlertController(title: "Register Public Key", message: "Choose a display name that others will see when verifying your attestations.", preferredStyle: .alert)
        alert.addTextField { textField in
            textField.placeholder = "Display name"
            textField.text = UIDevice.current.name
            textField.autocapitalizationType = .words
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Register", style: .default) { [weak self] _ in
            guard let self = self else { return }
            let displayName = alert.textFields?.first?.text?.trimmingCharacters(in: .whitespaces) ?? UIDevice.current.name
            self.doRegister(publicKey: key, name: displayName.isEmpty ? UIDevice.current.name : displayName)
        })
        present(alert, animated: true)
    }

    private func doRegister(publicKey: String, name: String) {
        let signature: String
        do {
            let result = try CryptoEngine.signRegistrationChallenge(name: name)
            signature = result.signature
        } catch {
            registerKeyButton.setTitle("Sign failed", for: .normal)
            registerKeyButton.tintColor = .systemRed
            return
        }

        let url = URL(string: "https://www.keywitness.io/api/keys/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = ["publicKey": publicKey, "name": name, "signature": signature]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        registerKeyButton.isEnabled = false
        registerKeyButton.setTitle("Registering...", for: .normal)

        URLSession.shared.dataTask(with: request) { [weak self] _, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200, error == nil {
                    self.registerKeyButton.setTitle("Registered as \"\(name)\"", for: .normal)
                    self.registerKeyButton.tintColor = .systemGreen
                } else {
                    self.registerKeyButton.setTitle("Failed", for: .normal)
                    self.registerKeyButton.tintColor = .systemRed
                }
                self.registerKeyButton.isEnabled = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                    self.registerKeyButton.setTitle("Register Key", for: .normal)
                    self.registerKeyButton.tintColor = self.accentColor
                }
            }
        }.resume()
    }

    // MARK: - Keyboard Dismiss

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        view.endEditing(true)
    }
}

// MARK: - UITextViewDelegate

extension MainViewController: UITextViewDelegate {
    func textViewDidBeginEditing(_ textView: UITextView) {
        if textView.textColor == .gray {
            textView.text = ""
            textView.textColor = .white
        }
    }

    func textViewDidEndEditing(_ textView: UITextView) {
        if textView.text.isEmpty {
            textView.text = "Tap here and switch to KeyWitness keyboard..."
            textView.textColor = .gray
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension MainViewController: UNUserNotificationCenterDelegate {
    /// Handle notification tap when app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        // Show the notification even when app is in foreground
        completionHandler([.banner, .sound])
    }

    /// Handle notification tap — triggers Face ID flow
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        if let shortId = userInfo["shortId"] as? String {
            performBiometricVerification(shortId: shortId)
        }
        completionHandler()
    }
}
