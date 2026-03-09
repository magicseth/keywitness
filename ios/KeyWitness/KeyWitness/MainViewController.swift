import UIKit
import LocalAuthentication
import UserNotifications
import ActivityKit

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
        setupAppAttest()

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

    // MARK: - App Attest Setup

    private func setupAppAttest() {
        let mgr = AppAttestManager.shared
        guard mgr.isSupported else {
            updateBiometricStatus("App Attest: NOT SUPPORTED on this device", color: .systemRed)
            return
        }
        updateBiometricStatus("App Attest: checking key…", color: .systemYellow)
        Task {
            do {
                try await mgr.setupIfNeeded()
                // Generate daily session token for the keyboard extension
                await mgr.refreshSessionToken()
                await MainActor.run {
                    let sessionStatus = mgr.hasValidSession ? "device token ✓" : "no device token"
                    updateBiometricStatus("App Attest: OK (\(sessionStatus))", color: .systemGreen)
                    clearBiometricStatusAfterDelay()
                }
            } catch {
                await MainActor.run {
                    updateBiometricStatus("App Attest FAILED: \(error.localizedDescription)", color: .systemRed)
                    // Don't auto-clear — let the user see the error
                }
            }
        }
    }

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
            defaults?.removeObject(forKey: "pendingBiometricCleartext")
            return
        }

        let cleartext = defaults?.string(forKey: "pendingBiometricCleartext")

        // Consume immediately so we don't re-trigger
        defaults?.removeObject(forKey: "pendingBiometricShortId")
        defaults?.removeObject(forKey: "pendingBiometricCreatedAt")
        defaults?.removeObject(forKey: "pendingBiometricCleartext")

        // Start Live Activity from the main app (extensions can't start them)
        startLiveActivity(shortId: shortId, cleartext: cleartext)

        // Show confirmation before Face ID
        showBiometricConfirmation(shortId: shortId, cleartext: cleartext)
    }

    /// Start a Live Activity with countdown timer on Dynamic Island / Lock Screen.
    /// Uses the stored expiration time from the keyboard so the countdown is accurate.
    private func startLiveActivity(shortId: String, cleartext: String?) {
        guard #available(iOS 16.2, *) else {
            print("[KeyWitness] Live Activities require iOS 16.2+")
            return
        }

        let authInfo = ActivityAuthorizationInfo()
        print("[KeyWitness] Live Activities enabled: \(authInfo.areActivitiesEnabled), frequentPushesEnabled: \(authInfo.frequentPushesEnabled)")
        guard authInfo.areActivitiesEnabled else {
            print("[KeyWitness] Live Activities not enabled in Settings")
            return
        }

        // Skip if we already have one running for this shortId
        let existing = Activity<KeyWitnessVerificationAttributes>.activities
        print("[KeyWitness] Current live activities: \(existing.count)")
        if existing.contains(where: { $0.attributes.shortId == shortId }) {
            print("[KeyWitness] Live Activity already exists for \(shortId)")
            return
        }

        // Use the stored expiration from the keyboard, or fall back to 30s from now
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        let storedExpiry = defaults?.object(forKey: "pendingBiometricExpiresAt") as? Date
        let expiresAt = storedExpiry ?? Date().addingTimeInterval(30)
        defaults?.removeObject(forKey: "pendingBiometricExpiresAt")
        print("[KeyWitness] Stored expiry: \(String(describing: storedExpiry)), using: \(expiresAt), now: \(Date())")

        let messagePreview: String
        if let text = cleartext, !text.isEmpty {
            if text.count > 100 {
                messagePreview = String(text.prefix(100)) + "..."
            } else {
                messagePreview = text
            }
        } else {
            messagePreview = "Pending verification"
        }

        let attributes = KeyWitnessVerificationAttributes(
            shortId: shortId,
            messagePreview: messagePreview,
            expiresAt: expiresAt
        )
        let state = KeyWitnessVerificationAttributes.ContentState(status: "waiting")
        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: state, staleDate: expiresAt),
                pushType: nil
            )
            print("[KeyWitness] Live Activity started: id=\(activity.id), shortId=\(shortId), expires=\(expiresAt)")
        } catch {
            print("[KeyWitness] Failed to start Live Activity: \(error)")
        }
    }

    // MARK: - Biometric Confirmation + Verification Flow

    /// Shows an alert with the message text so the user can review what they're confirming before Face ID.
    private func showBiometricConfirmation(shortId: String, cleartext: String?) {
        let preview: String
        if let text = cleartext, !text.isEmpty {
            // Show up to 200 characters with ellipsis
            if text.count > 200 {
                preview = "\"\(text.prefix(200))...\""
            } else {
                preview = "\"\(text)\""
            }
        } else {
            preview = "(message text unavailable)"
        }

        let alert = UIAlertController(
            title: "Confirm it's you",
            message: "You're proving that you — not an AI — wrote this message:\n\n\(preview)",
            preferredStyle: .alert
        )
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.updateBiometricStatus("Cancelled", color: .systemRed)
            self?.clearBiometricStatusAfterDelay()
            self?.endLiveActivity(shortId: shortId, status: "expired")
        })
        alert.addAction(UIAlertAction(title: "Confirm with Face ID", style: .default) { [weak self] _ in
            self?.performBiometricVerification(shortId: shortId)
        })
        present(alert, animated: true)
    }

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
                               localizedReason: "Confirm it was you who typed this message") { [weak self] success, _ in
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

        Task {
            do {
                let challenge = "keywitness:biometric:\(shortId)"
                guard let data = challenge.data(using: .utf8) else {
                    throw CryptoEngineError.encryptionFailed
                }
                let signature = try CryptoEngine.signBase64URL(data)
                let publicKey = try CryptoEngine.publicKeyBase64URL()

                // Also generate App Attest assertion from the main app
                // (keyboard extensions can't use App Attest, so the main app provides it)
                var appAttestKeyId: String? = nil
                var appAttestAssertion: String? = nil
                var appAttestClientData: String? = nil
                NSLog("[MainVC] App Attest isSupported=%d isAttested=%d keyId=%@",
                      AppAttestManager.shared.isSupported ? 1 : 0,
                      AppAttestManager.shared.isAttested ? 1 : 0,
                      AppAttestManager.shared.keyId ?? "nil")
                if AppAttestManager.shared.isSupported {
                    do {
                        let clientDataString = "keywitness:device-verify:\(shortId)"
                        let clientDataBytes = clientDataString.data(using: .utf8)!
                        self.updateBiometricStatus("Generating device attestation...", color: .systemYellow)
                        let assertion = try await AppAttestManager.shared.generateAssertion(for: clientDataBytes)
                        appAttestKeyId = AppAttestManager.shared.keyId
                        appAttestAssertion = CryptoEngine.base64URLEncode(assertion)
                        appAttestClientData = clientDataString
                        NSLog("[MainVC] App Attest assertion generated, keyId=%@", appAttestKeyId ?? "nil")
                    } catch {
                        NSLog("[MainVC] App Attest assertion failed: %@", error.localizedDescription)
                        self.updateBiometricStatus("Device attest failed: \(error.localizedDescription)", color: .systemOrange)
                    }
                } else {
                    NSLog("[MainVC] App Attest NOT SUPPORTED")
                }

                let url = URL(string: "https://www.keywitness.io/api/attestations/verify-biometric")!
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("application/json", forHTTPHeaderField: "Content-Type")

                var payload: [String: String] = [
                    "shortId": shortId,
                    "signature": signature,
                    "publicKey": publicKey,
                ]
                if let keyId = appAttestKeyId { payload["appAttestKeyId"] = keyId }
                if let assertion = appAttestAssertion { payload["appAttestAssertion"] = assertion }
                if let clientData = appAttestClientData { payload["appAttestClientData"] = clientData }

                request.httpBody = try JSONSerialization.data(withJSONObject: payload)

                let (respData, response) = try await URLSession.shared.data(for: request)
                let respJson = try? JSONSerialization.jsonObject(with: respData) as? [String: Any]
                let deviceVerified = respJson?["deviceVerified"] as? Bool ?? false
                let appAttestErr = respJson?["appAttestError"] as? String
                await MainActor.run {
                    if let httpResponse = response as? HTTPURLResponse,
                       httpResponse.statusCode == 200 {
                        var msg = "✓ Confirmed!"
                        if deviceVerified {
                            msg += " Device verified ✓"
                        } else if let err = appAttestErr {
                            msg += " (device: \(err))"
                        } else if appAttestKeyId == nil {
                            msg += " (no App Attest key)"
                        }
                        self.updateBiometricStatus(msg, color: deviceVerified ? .systemGreen : .systemYellow)
                        self.endLiveActivity(shortId: shortId, status: "verified")
                    } else {
                        var msg = "Upload failed"
                        if let errorMsg = respJson?["error"] as? String {
                            msg = errorMsg
                        }
                        self.updateBiometricStatus(msg, color: .systemRed)
                    }
                    self.clearBiometricStatusAfterDelay()
                }
            } catch {
                await MainActor.run {
                    self.updateBiometricStatus("Signing error: \(error.localizedDescription)", color: .systemRed)
                    self.clearBiometricStatusAfterDelay()
                }
            }
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

    /// End any active Live Activity for the given shortId.
    private func endLiveActivity(shortId: String, status: String) {
        if #available(iOS 16.2, *) {
            let finalState = KeyWitnessVerificationAttributes.ContentState(status: status)
            for activity in Activity<KeyWitnessVerificationAttributes>.activities {
                if activity.attributes.shortId == shortId {
                    Task {
                        await activity.end(
                            .init(state: finalState, staleDate: nil),
                            dismissalPolicy: .after(.now + 2)
                        )
                    }
                }
            }
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
        subtitleLabel.text = "Proof you're human. Not AI."
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
        header.text = "How to Use"
        header.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        header.textColor = .white

        instructionsLabel.numberOfLines = 0
        instructionsLabel.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        instructionsLabel.textColor = UIColor.lightGray
        instructionsLabel.text = """
        1. Go to Settings > General > Keyboard > Keyboards
        2. Tap "Add New Keyboard..." and pick KeyWitness
        3. Turn on "Allow Full Access" (needed to save your proof)
        4. In any app, switch to the KeyWitness keyboard
        5. Type your message, then tap "Seal" to prove you wrote it

        A link will appear — anyone who opens it can see that a real person typed this message, not an AI.
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

        publicKeyHeader.text = "Your Name"
        publicKeyHeader.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        publicKeyHeader.textColor = .white

        publicKeyLabel.numberOfLines = 0
        publicKeyLabel.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        publicKeyLabel.textColor = accentColor
        publicKeyLabel.text = "Loading..."
        publicKeyLabel.textAlignment = .center

        copyKeyButton.setTitle("Copy ID", for: .normal)
        copyKeyButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        copyKeyButton.tintColor = accentColor
        copyKeyButton.addTarget(self, action: #selector(copyPublicKey), for: .touchUpInside)

        registerKeyButton.setTitle("Set Your Name", for: .normal)
        registerKeyButton.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        registerKeyButton.tintColor = accentColor
        registerKeyButton.addTarget(self, action: #selector(registerPublicKey), for: .touchUpInside)

        let description = UILabel()
        description.text = "Add your name so people know who wrote the message."
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

        testHeader.text = "Try It"
        testHeader.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        testHeader.textColor = .white

        testTextView.font = UIFont.systemFont(ofSize: 15)
        testTextView.textColor = .white
        testTextView.backgroundColor = UIColor(red: 0.18, green: 0.18, blue: 0.20, alpha: 1.0)
        testTextView.layer.cornerRadius = 8
        testTextView.textContainerInset = UIEdgeInsets(top: 12, left: 8, bottom: 12, right: 8)
        testTextView.isScrollEnabled = true
        testTextView.text = "Tap here, switch to KeyWitness keyboard, and type something..."
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

        let alert = UIAlertController(title: "What's your name?", message: "This is how people will know it's you.", preferredStyle: .alert)
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
            textView.text = "Tap here, switch to KeyWitness keyboard, and type something..."
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

    /// Handle notification tap — shows confirmation then triggers Face ID flow
    func userNotificationCenter(_ center: UNUserNotificationCenter,
                                didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let userInfo = response.notification.request.content.userInfo
        if let shortId = userInfo["shortId"] as? String {
            // Get cleartext from notification userInfo (preferred) or shared defaults (fallback)
            let cleartext = (userInfo["cleartext"] as? String)
                ?? UserDefaults(suiteName: "group.io.keywitness")?.string(forKey: "pendingBiometricCleartext")

            // Clean up so checkPendingBiometric doesn't also fire
            let defaults = UserDefaults(suiteName: "group.io.keywitness")
            defaults?.removeObject(forKey: "pendingBiometricShortId")
            defaults?.removeObject(forKey: "pendingBiometricCreatedAt")
            defaults?.removeObject(forKey: "pendingBiometricCleartext")

            // Start Live Activity from the main app
            startLiveActivity(shortId: shortId, cleartext: cleartext)
            showBiometricConfirmation(shortId: shortId, cleartext: cleartext)
        }
        completionHandler()
    }
}
