import UIKit
import LocalAuthentication
import UserNotifications
import ActivityKit
import CoreBluetooth

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
    private let usernameStatusLabel = UILabel()
    private let testHeader = UILabel()
    private let testTextView = UITextView()
    private let biometricStatusLabel = UILabel()
    private let emojiToggle = UISwitch()
    private let recoverButton = UIButton(type: .system)

    // MARK: - BLE

    private var bleManager: BLEPeripheralManager?
    private var bleAttestationFlow: BLEAttestationFlow?
    private let bleToggle = UISwitch()
    private let bleStatusLabel = UILabel()
    private let bleKeystrokeCount = UILabel()

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
        cleanupStaleActivities()

        // Notification delegate is set in AppDelegate to ensure cold-launch taps are handled

        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillShow(_:)), name: UIResponder.keyboardWillShowNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(keyboardWillHide(_:)), name: UIResponder.keyboardWillHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(appDidBecomeActive), name: UIApplication.didBecomeActiveNotification, object: nil)
    }

    private func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        checkPendingBiometric()
    }

    @objc private func appDidBecomeActive() {
        // Delay slightly so didReceive (notification tap) can run first and
        // clean up the pending data, avoiding a double-trigger race.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.checkPendingBiometric()
        }
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
            NSLog("[KeyWitness] checkPendingBiometric: no pending biometric found")
            return
        }

        // Check 5-minute window (Face ID is the real security gate, not the timer)
        let age = Date().timeIntervalSince(createdAt)
        NSLog("[KeyWitness] checkPendingBiometric: shortId=%@, age=%.1fs", shortId, age)
        if age > 300 {
            // Expired — clean up
            NSLog("[KeyWitness] checkPendingBiometric: expired (%.1fs old)", age)
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

        // Delay slightly — the app may not be fully foregrounded yet
        // (Activity.request requires foreground state)
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.startLiveActivity(shortId: shortId, cleartext: cleartext)
        }
        showBiometricConfirmation(shortId: shortId, cleartext: cleartext)
    }

    /// Start a Live Activity with countdown timer on Dynamic Island / Lock Screen.
    /// Uses the stored expiration time from the keyboard so the countdown is accurate.
    private func startLiveActivity(shortId: String, cleartext: String?) {
        guard #available(iOS 16.2, *) else {
            NSLog("[KeyWitness] Live Activities require iOS 16.2+")
            updateBiometricStatus("Live Activities require iOS 16.2+", color: .systemOrange)
            return
        }

        let authInfo = ActivityAuthorizationInfo()
        NSLog("[KeyWitness] Live Activities enabled: %d, frequentPushes: %d", authInfo.areActivitiesEnabled ? 1 : 0, authInfo.frequentPushesEnabled ? 1 : 0)
        guard authInfo.areActivitiesEnabled else {
            NSLog("[KeyWitness] Live Activities not enabled in Settings")
            updateBiometricStatus("Enable Live Activities in Settings > KeyWitness", color: .systemOrange)
            return
        }

        // Skip if we already have one running for this shortId
        let existing = Activity<KeyWitnessVerificationAttributes>.activities
        NSLog("[KeyWitness] Current live activities: %d", existing.count)
        if existing.contains(where: { $0.attributes.shortId == shortId }) {
            NSLog("[KeyWitness] Live Activity already exists for %@", shortId)
            return
        }

        // Always use 30s from now — the stored expiry from the keyboard may already
        // be stale by the time the user taps the notification and the app opens.
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        defaults?.removeObject(forKey: "pendingBiometricExpiresAt")
        let expiresAt = Date().addingTimeInterval(30)
        NSLog("[KeyWitness] Live Activity expiresAt: %@, now: %@", "\(expiresAt)", "\(Date())")

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
            NSLog("[KeyWitness] Live Activity started: id=%@, shortId=%@", activity.id, shortId)
        } catch {
            NSLog("[KeyWitness] Failed to start Live Activity: %@", error.localizedDescription)
            updateBiometricStatus("Live Activity error: \(error.localizedDescription)", color: .systemRed)
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
                        // Keep the completed activity visible for 30 seconds so the user
                        // can see the result in Dynamic Island / Lock Screen
                        await activity.end(
                            .init(state: finalState, staleDate: nil),
                            dismissalPolicy: .after(.now + 30)
                        )
                        NSLog("[KeyWitness] Live Activity ended: shortId=%@, status=%@", shortId, status)
                    }
                }
            }
        }
    }

    // MARK: - Activity Cleanup

    /// End all stale Live Activities from previous sessions on app launch.
    private func cleanupStaleActivities() {
        if #available(iOS 16.2, *) {
            let activities = Activity<KeyWitnessVerificationAttributes>.activities
            NSLog("[KeyWitness] Cleanup: found %d existing activities", activities.count)
            for activity in activities {
                NSLog("[KeyWitness] Cleanup: ending stale activity %@ (shortId=%@)", activity.id, activity.attributes.shortId)
                let finalState = KeyWitnessVerificationAttributes.ContentState(status: "expired")
                Task {
                    await activity.end(
                        .init(state: finalState, staleDate: nil),
                        dismissalPolicy: .immediate
                    )
                }
            }
        }
    }

    // MARK: - Voice Attestation

    @objc private func voiceButtonTapped() {
        let voiceVC = VoiceRecordingViewController()
        voiceVC.modalPresentationStyle = .fullScreen
        present(voiceVC, animated: true)
    }

    // MARK: - Photo Attestation

    @objc private func photoButtonTapped() {
        let photoVC = PhotoCaptureViewController()
        photoVC.modalPresentationStyle = .fullScreen
        present(photoVC, animated: true)
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

    // MARK: - UI Helpers

    private let statusDotSize: CGFloat = 6
    private let greenGlow = UIColor(red: 0.20, green: 0.83, blue: 0.47, alpha: 1.0)
    private let dimText = UIColor(red: 0.40, green: 0.40, blue: 0.44, alpha: 1.0)
    private let cardBorder = UIColor(red: 0.18, green: 0.18, blue: 0.22, alpha: 1.0)
    private let fieldBg = UIColor(red: 0.08, green: 0.08, blue: 0.10, alpha: 1.0)

    private func makeCard() -> UIView {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 16
        card.layer.borderWidth = 0.5
        card.layer.borderColor = cardBorder.cgColor
        card.translatesAutoresizingMaskIntoConstraints = false
        return card
    }

    private func makeSectionLabel(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text.uppercased()
        label.font = UIFont.systemFont(ofSize: 11, weight: .semibold)
        label.textColor = dimText
        label.setContentHuggingPriority(.required, for: .vertical)
        return label
    }

    private func makeStatusPill(icon: String, label: String, active: Bool) -> UIView {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let dot = UIView()
        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.backgroundColor = active ? greenGlow : UIColor(white: 0.3, alpha: 1)
        dot.layer.cornerRadius = statusDotSize / 2
        if active {
            dot.layer.shadowColor = greenGlow.cgColor
            dot.layer.shadowRadius = 4
            dot.layer.shadowOpacity = 0.6
            dot.layer.shadowOffset = .zero
        }

        let iconView = UIImageView(image: UIImage(systemName: icon))
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.tintColor = active ? UIColor.white : dimText
        iconView.contentMode = .scaleAspectFit

        let textLabel = UILabel()
        textLabel.text = label
        textLabel.font = UIFont.systemFont(ofSize: 10, weight: .medium)
        textLabel.textColor = active ? UIColor(white: 0.85, alpha: 1) : dimText

        let stack = UIStackView(arrangedSubviews: [dot, iconView, textLabel])
        stack.axis = .horizontal
        stack.spacing = 4
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(stack)
        NSLayoutConstraint.activate([
            dot.widthAnchor.constraint(equalToConstant: statusDotSize),
            dot.heightAnchor.constraint(equalToConstant: statusDotSize),
            iconView.widthAnchor.constraint(equalToConstant: 12),
            iconView.heightAnchor.constraint(equalToConstant: 12),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 6),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 10),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -10),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -6),
        ])

        container.backgroundColor = UIColor(white: 0.10, alpha: 1)
        container.layer.cornerRadius = 12
        container.layer.borderWidth = 0.5
        container.layer.borderColor = UIColor(white: 0.18, alpha: 1).cgColor

        return container
    }

    private func makeStatBlock(value: String, label: String) -> UIView {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false

        let valueLabel = UILabel()
        valueLabel.text = value
        valueLabel.font = UIFont.monospacedDigitSystemFont(ofSize: 28, weight: .bold)
        valueLabel.textColor = .white
        valueLabel.textAlignment = .center
        valueLabel.tag = label.hashValue  // for updating later

        let descLabel = UILabel()
        descLabel.text = label.uppercased()
        descLabel.font = UIFont.systemFont(ofSize: 9, weight: .semibold)
        descLabel.textColor = dimText
        descLabel.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [valueLabel, descLabel])
        stack.axis = .vertical
        stack.spacing = 2
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 12),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -12),
        ])

        return container
    }

    private var sealsStatLabel: UILabel?
    private var keystrokesStatLabel: UILabel?

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
        contentStack.spacing = 16
        contentStack.alignment = .fill
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
        NSLayoutConstraint.activate([
            contentStack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 16),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 20),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -20),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -32),
            contentStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -40)
        ])

        // ── Header ──────────────────────────────────────────────
        setupHeader()

        // ── Status Pills ────────────────────────────────────────
        setupStatusPills()

        // ── Biometric status (hidden by default) ────────────────
        biometricStatusLabel.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        biometricStatusLabel.textAlignment = .center
        biometricStatusLabel.numberOfLines = 0
        biometricStatusLabel.isHidden = true
        contentStack.addArrangedSubview(biometricStatusLabel)

        // ── Identity Card ───────────────────────────────────────
        setupIdentityCard()

        // ── Stats Row ───────────────────────────────────────────
        setupStatsRow()

        // ── Compose Card ────────────────────────────────────────
        setupComposeCard()

        // ── How It Works ────────────────────────────────────────
        setupHowItWorksCard()

        // ── BLE Card ────────────────────────────────────────────
        setupBLECard()

        // ── Settings Card ───────────────────────────────────────
        setupSettingsCard()

        // ── Footer ──────────────────────────────────────────────
        setupFooter()
    }

    private func setupHeader() {
        let container = UIView()
        container.translatesAutoresizingMaskIntoConstraints = false

        // Fingerprint icon
        let icon = UIImageView(image: UIImage(systemName: "checkmark.seal.fill"))
        icon.translatesAutoresizingMaskIntoConstraints = false
        icon.tintColor = greenGlow
        icon.contentMode = .scaleAspectFit

        titleLabel.text = "KeyWitness"
        titleLabel.font = UIFont.systemFont(ofSize: 28, weight: .bold)
        titleLabel.textColor = .white

        let titleRow = UIStackView(arrangedSubviews: [icon, titleLabel])
        titleRow.axis = .horizontal
        titleRow.spacing = 8
        titleRow.alignment = .center
        titleRow.translatesAutoresizingMaskIntoConstraints = false

        subtitleLabel.text = "Cryptographic proof of human input"
        subtitleLabel.font = UIFont.systemFont(ofSize: 13, weight: .regular)
        subtitleLabel.textColor = dimText
        subtitleLabel.textAlignment = .center

        let stack = UIStackView(arrangedSubviews: [titleRow, subtitleLabel])
        stack.axis = .vertical
        stack.spacing = 4
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false

        container.addSubview(stack)
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 24),
            icon.heightAnchor.constraint(equalToConstant: 24),
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 8),
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -8),
        ])

        contentStack.addArrangedSubview(container)
    }

    private func setupStatusPills() {
        let keyboardEnabled = isKeyboardEnabled()
        let faceIdAvailable = LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        let appAttestSupported = AppAttestManager.shared.isSupported

        let pills = UIStackView(arrangedSubviews: [
            makeStatusPill(icon: "keyboard", label: "Keyboard", active: keyboardEnabled),
            makeStatusPill(icon: "faceid", label: "Face ID", active: faceIdAvailable),
            makeStatusPill(icon: "checkmark.shield", label: "Device", active: appAttestSupported),
        ])
        pills.axis = .horizontal
        pills.spacing = 6
        pills.distribution = .fillEqually
        contentStack.addArrangedSubview(pills)
    }

    private func isKeyboardEnabled() -> Bool {
        let modes = UITextInputMode.activeInputModes
        return modes.contains { mode in
            guard let id = mode.value(forKey: "identifier") as? String else { return false }
            return id.contains("io.keywitness")
        }
    }

    private func setupIdentityCard() {
        let card = makeCard()
        contentStack.addArrangedSubview(card)

        let sectionLabel = makeSectionLabel("Your Identity")

        // Username (large, prominent)
        usernameStatusLabel.font = UIFont.systemFont(ofSize: 22, weight: .bold)
        usernameStatusLabel.textColor = .white
        usernameStatusLabel.textAlignment = .left
        usernameStatusLabel.numberOfLines = 1
        usernameStatusLabel.isHidden = true

        // DID key
        publicKeyHeader.isHidden = true // not needed in new design
        publicKeyLabel.numberOfLines = 1
        publicKeyLabel.lineBreakMode = .byTruncatingMiddle
        publicKeyLabel.font = UIFont.monospacedSystemFont(ofSize: 11, weight: .regular)
        publicKeyLabel.textColor = dimText
        publicKeyLabel.text = "Loading..."

        // Action buttons row
        copyKeyButton.setTitle("Copy", for: .normal)
        copyKeyButton.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        copyKeyButton.tintColor = accentColor
        copyKeyButton.addTarget(self, action: #selector(copyPublicKey), for: .touchUpInside)

        registerKeyButton.setTitle("Claim Username", for: .normal)
        registerKeyButton.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        registerKeyButton.tintColor = accentColor
        registerKeyButton.addTarget(self, action: #selector(claimUsername), for: .touchUpInside)

        recoverButton.setTitle("Recover", for: .normal)
        recoverButton.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        recoverButton.tintColor = .systemOrange
        recoverButton.addTarget(self, action: #selector(recoverUsername), for: .touchUpInside)

        let separator = UIView()
        separator.translatesAutoresizingMaskIntoConstraints = false
        separator.backgroundColor = UIColor(white: 1, alpha: 0.06)
        separator.heightAnchor.constraint(equalToConstant: 0.5).isActive = true

        let buttonsRow = UIStackView(arrangedSubviews: [copyKeyButton, registerKeyButton, recoverButton])
        buttonsRow.axis = .horizontal
        buttonsRow.spacing = 16
        buttonsRow.distribution = .fillEqually

        let stack = UIStackView(arrangedSubviews: [sectionLabel, usernameStatusLabel, publicKeyLabel, separator, buttonsRow])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])

        loadUsername()
    }

    private func setupStatsRow() {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        let sealsCount = defaults?.integer(forKey: "sealCount") ?? 0
        let keystrokeCount = defaults?.integer(forKey: "keystrokeCount") ?? 0

        let card = makeCard()
        contentStack.addArrangedSubview(card)

        let sealsBlock = makeStatBlock(value: "\(sealsCount)", label: "Seals")
        let keystrokesBlock = makeStatBlock(value: "\(keystrokeCount)", label: "Keystrokes")

        // Vertical divider
        let divider = UIView()
        divider.translatesAutoresizingMaskIntoConstraints = false
        divider.backgroundColor = UIColor(white: 1, alpha: 0.06)
        divider.widthAnchor.constraint(equalToConstant: 0.5).isActive = true

        let row = UIStackView(arrangedSubviews: [sealsBlock, divider, keystrokesBlock])
        row.axis = .horizontal
        row.distribution = .fillEqually
        row.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: card.topAnchor),
            row.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            row.bottomAnchor.constraint(equalTo: card.bottomAnchor),
            divider.heightAnchor.constraint(equalTo: row.heightAnchor, multiplier: 0.5),
            divider.centerYAnchor.constraint(equalTo: row.centerYAnchor),
        ])

        // Store references for updating
        sealsStatLabel = sealsBlock.subviews.first?.subviews.first { $0 is UIStackView }?.subviews.first as? UILabel
        keystrokesStatLabel = keystrokesBlock.subviews.first?.subviews.first { $0 is UIStackView }?.subviews.first as? UILabel

        // Find the labels more reliably
        func findValueLabel(in view: UIView) -> UILabel? {
            for sub in view.subviews {
                if let label = sub as? UILabel, label.font.pointSize >= 28 { return label }
                if let found = findValueLabel(in: sub) { return found }
            }
            return nil
        }
        sealsStatLabel = findValueLabel(in: sealsBlock)
        keystrokesStatLabel = findValueLabel(in: keystrokesBlock)
    }

    private func setupComposeCard() {
        let card = makeCard()
        contentStack.addArrangedSubview(card)

        let sectionLabel = makeSectionLabel("Compose")

        testHeader.text = "Type something and seal it"
        testHeader.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        testHeader.textColor = UIColor(white: 0.55, alpha: 1)

        testTextView.font = UIFont.systemFont(ofSize: 16)
        testTextView.textColor = .white
        testTextView.backgroundColor = fieldBg
        testTextView.layer.cornerRadius = 12
        testTextView.layer.borderWidth = 0.5
        testTextView.layer.borderColor = UIColor(white: 0.16, alpha: 1).cgColor
        testTextView.textContainerInset = UIEdgeInsets(top: 14, left: 12, bottom: 14, right: 12)
        testTextView.isScrollEnabled = true
        testTextView.text = "Switch to KeyWitness keyboard and start typing..."
        testTextView.textColor = dimText
        testTextView.delegate = self
        testTextView.heightAnchor.constraint(greaterThanOrEqualToConstant: 140).isActive = true

        // Alternative attestation buttons
        let voiceButton = UIButton(type: .system)
        voiceButton.setTitle(" Voice", for: .normal)
        voiceButton.setImage(UIImage(systemName: "waveform"), for: .normal)
        voiceButton.tintColor = UIColor(white: 0.65, alpha: 1)
        voiceButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        voiceButton.backgroundColor = UIColor(white: 0.10, alpha: 1)
        voiceButton.layer.cornerRadius = 10
        voiceButton.layer.borderWidth = 0.5
        voiceButton.layer.borderColor = UIColor(white: 0.18, alpha: 1).cgColor
        voiceButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        voiceButton.addTarget(self, action: #selector(voiceButtonTapped), for: .touchUpInside)

        let photoButton = UIButton(type: .system)
        photoButton.setTitle(" Photo", for: .normal)
        photoButton.setImage(UIImage(systemName: "camera"), for: .normal)
        photoButton.tintColor = UIColor(white: 0.65, alpha: 1)
        photoButton.titleLabel?.font = .systemFont(ofSize: 13, weight: .semibold)
        photoButton.backgroundColor = UIColor(white: 0.10, alpha: 1)
        photoButton.layer.cornerRadius = 10
        photoButton.layer.borderWidth = 0.5
        photoButton.layer.borderColor = UIColor(white: 0.18, alpha: 1).cgColor
        photoButton.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        photoButton.addTarget(self, action: #selector(photoButtonTapped), for: .touchUpInside)

        let orLabel = UILabel()
        orLabel.text = "or attest with"
        orLabel.font = UIFont.systemFont(ofSize: 11, weight: .regular)
        orLabel.textColor = dimText

        let altRow = UIStackView(arrangedSubviews: [orLabel, voiceButton, photoButton])
        altRow.axis = .horizontal
        altRow.spacing = 8
        altRow.alignment = .center

        let stack = UIStackView(arrangedSubviews: [sectionLabel, testHeader, testTextView, altRow])
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
        ])
    }

    private func setupInstructionsCard() {
        // Collapsed by default — just a hint for new users
        instructionsCard.backgroundColor = cardColor
        instructionsCard.layer.cornerRadius = 16
        instructionsCard.layer.borderWidth = 0.5
        instructionsCard.layer.borderColor = cardBorder.cgColor
        instructionsCard.translatesAutoresizingMaskIntoConstraints = false
        // Only show if keyboard isn't enabled yet
        if !isKeyboardEnabled() {
            contentStack.addArrangedSubview(instructionsCard)
        }

        let header = UILabel()
        header.text = "Setup Required"
        header.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        header.textColor = .systemOrange

        instructionsLabel.numberOfLines = 0
        instructionsLabel.font = UIFont.systemFont(ofSize: 13, weight: .regular)
        instructionsLabel.textColor = UIColor(white: 0.55, alpha: 1)
        instructionsLabel.text = "Settings → General → Keyboard → Keyboards → Add New Keyboard → KeyWitness → Allow Full Access"

        let openSettings = UIButton(type: .system)
        openSettings.setTitle("Open Settings", for: .normal)
        openSettings.titleLabel?.font = UIFont.systemFont(ofSize: 13, weight: .semibold)
        openSettings.tintColor = accentColor
        openSettings.addTarget(self, action: #selector(openSettingsTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [header, instructionsLabel, openSettings])
        stack.axis = .vertical
        stack.spacing = 8
        stack.alignment = .leading
        stack.translatesAutoresizingMaskIntoConstraints = false
        instructionsCard.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: instructionsCard.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: instructionsCard.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: instructionsCard.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: instructionsCard.bottomAnchor, constant: -14)
        ])
    }

    @objc private func openSettingsTapped() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }

    private func setupPublicKeySection() {
        // No longer used — identity is in setupIdentityCard
    }

    private func setupTestField() {
        // No longer used — compose is in setupComposeCard
    }

    private func setupSettingsCard() {
        let card = makeCard()
        contentStack.addArrangedSubview(card)

        let sectionLabel = makeSectionLabel("Settings")

        // Emoji toggle row
        let emojiIcon = UIImageView(image: UIImage(systemName: "face.smiling"))
        emojiIcon.translatesAutoresizingMaskIntoConstraints = false
        emojiIcon.tintColor = UIColor(white: 0.55, alpha: 1)
        emojiIcon.contentMode = .scaleAspectFit
        emojiIcon.widthAnchor.constraint(equalToConstant: 18).isActive = true
        emojiIcon.heightAnchor.constraint(equalToConstant: 18).isActive = true

        let emojiLabel = UILabel()
        emojiLabel.text = "Emoji Links"
        emojiLabel.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        emojiLabel.textColor = .white

        let emojiDesc = UILabel()
        emojiDesc.text = "Encode keys as emoji instead of base64"
        emojiDesc.font = UIFont.systemFont(ofSize: 11, weight: .regular)
        emojiDesc.textColor = dimText

        let labelStack = UIStackView(arrangedSubviews: [emojiLabel, emojiDesc])
        labelStack.axis = .vertical
        labelStack.spacing = 2

        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        emojiToggle.isOn = defaults?.bool(forKey: "useEmojiLinks") ?? false
        emojiToggle.onTintColor = accentColor
        emojiToggle.addTarget(self, action: #selector(emojiToggleChanged), for: .valueChanged)

        let emojiRow = UIStackView(arrangedSubviews: [emojiIcon, labelStack, emojiToggle])
        emojiRow.axis = .horizontal
        emojiRow.spacing = 10
        emojiRow.alignment = .center

        let stack = UIStackView(arrangedSubviews: [sectionLabel, emojiRow])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])
    }

    private func setupFooter() {
        let footer = UILabel()
        footer.text = "keywitness.io — open source, open standards"
        footer.font = UIFont.systemFont(ofSize: 11, weight: .regular)
        footer.textColor = UIColor(white: 0.25, alpha: 1)
        footer.textAlignment = .center
        contentStack.addArrangedSubview(footer)
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

    // MARK: - Username

    private func loadUsername() {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        if let username = defaults?.string(forKey: "claimedUsername") {
            usernameStatusLabel.text = username
            usernameStatusLabel.isHidden = false
            registerKeyButton.setTitle("Change", for: .normal)
        }
    }

    @objc private func claimUsername() {
        guard let key = publicKeyLabel.text, !key.starts(with: "Error"), !key.starts(with: "Loading") else {
            return
        }

        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        let currentUsername = defaults?.string(forKey: "claimedUsername")

        let alert = UIAlertController(
            title: "Claim Username",
            message: "Pick a username for your typed.by links.\nAn email is required for account recovery only.",
            preferredStyle: .alert
        )
        alert.addTextField { textField in
            textField.placeholder = "Username (e.g. magicseth)"
            textField.text = currentUsername
            textField.autocapitalizationType = .none
            textField.autocorrectionType = .no
        }
        alert.addTextField { textField in
            textField.placeholder = "Recovery email"
            textField.keyboardType = .emailAddress
            textField.autocapitalizationType = .none
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Claim", style: .default) { [weak self] _ in
            guard let self = self else { return }
            let username = alert.textFields?[0].text?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
            let email = alert.textFields?[1].text?.trimmingCharacters(in: .whitespaces) ?? ""
            guard !username.isEmpty, !email.isEmpty else {
                self.registerKeyButton.setTitle("Username & email required", for: .normal)
                self.registerKeyButton.tintColor = .systemRed
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    self.registerKeyButton.setTitle("Claim Username", for: .normal)
                    self.registerKeyButton.tintColor = self.accentColor
                }
                return
            }
            self.doClaimUsername(publicKey: key, username: username, email: email)
        })
        present(alert, animated: true)
    }

    private func doClaimUsername(publicKey: String, username: String, email: String) {
        // Sign proof-of-possession for the username claim
        let signature: String
        do {
            signature = try CryptoEngine.signUsernameClaim(username: username)
        } catch {
            NSLog("[KeyWitness] Failed to sign username claim: %@", error.localizedDescription)
            registerKeyButton.setTitle("Signing failed", for: .normal)
            registerKeyButton.tintColor = .systemRed
            return
        }

        let url = URL(string: "https://www.keywitness.io/api/usernames/claim")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = [
            "username": username,
            "publicKey": publicKey,
            "email": email,
            "signature": signature,
        ]
        NSLog("[KeyWitness] Claim payload: username=%@, publicKey=%d chars, email=%@, signature=%d chars",
              username, publicKey.count, email, signature.count)
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        if request.httpBody == nil {
            NSLog("[KeyWitness] ERROR: JSON serialization returned nil!")
        }

        registerKeyButton.isEnabled = false
        registerKeyButton.setTitle("Claiming...", for: .normal)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.registerKeyButton.isEnabled = true

                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode == 201,
                   error == nil {
                    // Save username to shared defaults so keyboard can use it
                    let defaults = UserDefaults(suiteName: "group.io.keywitness")
                    defaults?.set(username, forKey: "claimedUsername")

                    // Also register the display name for backwards compat
                    self.doRegisterName(publicKey: publicKey, name: username)

                    self.usernameStatusLabel.text = username
                    self.usernameStatusLabel.isHidden = false
                    self.registerKeyButton.setTitle("Change", for: .normal)
                    self.registerKeyButton.tintColor = self.accentColor
                } else {
                    var errorMsg = "Failed"
                    if let data = data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let err = json["error"] as? String {
                        errorMsg = err
                    }
                    self.registerKeyButton.setTitle(errorMsg, for: .normal)
                    self.registerKeyButton.tintColor = .systemRed
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                        self.loadUsername()
                        self.registerKeyButton.tintColor = self.accentColor
                    }
                }
            }
        }.resume()
    }

    /// Also register the key with a display name (backwards compat with /api/keys/register).
    private func doRegisterName(publicKey: String, name: String) {
        guard let signature = try? CryptoEngine.signRegistrationChallenge(name: name).signature else { return }

        let url = URL(string: "https://www.keywitness.io/api/keys/register")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: [
            "publicKey": publicKey, "name": name, "signature": signature,
        ])
        URLSession.shared.dataTask(with: request) { _, _, _ in }.resume()
    }

    // MARK: - BLE Card

    private func setupBLECard() {
        let card = makeCard()
        contentStack.addArrangedSubview(card)

        let sectionLabel = makeSectionLabel("Web Attestation")

        let bleIcon = UIImageView(image: UIImage(systemName: "antenna.radiowaves.left.and.right"))
        bleIcon.translatesAutoresizingMaskIntoConstraints = false
        bleIcon.tintColor = UIColor(white: 0.55, alpha: 1)
        bleIcon.contentMode = .scaleAspectFit
        bleIcon.widthAnchor.constraint(equalToConstant: 18).isActive = true
        bleIcon.heightAnchor.constraint(equalToConstant: 18).isActive = true

        let toggleLabel = UILabel()
        toggleLabel.text = "Bluetooth"
        toggleLabel.font = UIFont.systemFont(ofSize: 15, weight: .medium)
        toggleLabel.textColor = .white

        let toggleDesc = UILabel()
        toggleDesc.text = "Attest text typed in web browsers"
        toggleDesc.font = UIFont.systemFont(ofSize: 11, weight: .regular)
        toggleDesc.textColor = dimText

        let labelStack = UIStackView(arrangedSubviews: [toggleLabel, toggleDesc])
        labelStack.axis = .vertical
        labelStack.spacing = 2

        bleToggle.onTintColor = accentColor
        bleToggle.addTarget(self, action: #selector(bleToggleChanged), for: .valueChanged)

        let toggleRow = UIStackView(arrangedSubviews: [bleIcon, labelStack, bleToggle])
        toggleRow.axis = .horizontal
        toggleRow.spacing = 10
        toggleRow.alignment = .center

        bleStatusLabel.font = UIFont.systemFont(ofSize: 12, weight: .medium)
        bleStatusLabel.textColor = dimText
        bleStatusLabel.text = "Off"

        bleKeystrokeCount.font = UIFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        bleKeystrokeCount.textColor = accentColor
        bleKeystrokeCount.isHidden = true

        let stack = UIStackView(arrangedSubviews: [sectionLabel, toggleRow, bleStatusLabel, bleKeystrokeCount])
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14)
        ])
    }

    @objc private func bleToggleChanged() {
        if bleToggle.isOn {
            if bleManager == nil {
                bleManager = BLEPeripheralManager()
                bleManager?.delegate = self
                bleAttestationFlow = BLEAttestationFlow(viewController: self, bleManager: bleManager!)
            }
            bleStatusLabel.text = "Starting BLE…"
            bleStatusLabel.textColor = .systemYellow
            bleManager?.startAdvertising()
        } else {
            bleManager?.stopAdvertising()
            bleStatusLabel.text = "Off"
            bleStatusLabel.textColor = .lightGray
            bleKeystrokeCount.isHidden = true
        }
    }

    // MARK: - Emoji Toggle

    @objc private func emojiToggleChanged() {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        defaults?.set(emojiToggle.isOn, forKey: "useEmojiLinks")
    }

    // MARK: - Username Recovery

    @objc private func recoverUsername() {
        guard let key = publicKeyLabel.text, !key.starts(with: "Error"), !key.starts(with: "Loading") else {
            return
        }

        let alert = UIAlertController(
            title: "Recover Username",
            message: "Enter your username and the email you registered with to transfer it to this device.",
            preferredStyle: .alert
        )
        alert.addTextField { textField in
            textField.placeholder = "Username"
            textField.autocapitalizationType = .none
            textField.autocorrectionType = .no
        }
        alert.addTextField { textField in
            textField.placeholder = "Recovery email"
            textField.keyboardType = .emailAddress
            textField.autocapitalizationType = .none
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "Recover", style: .default) { [weak self] _ in
            guard let self = self else { return }
            let username = alert.textFields?[0].text?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
            let email = alert.textFields?[1].text?.trimmingCharacters(in: .whitespaces) ?? ""
            guard !username.isEmpty, !email.isEmpty else {
                self.recoverButton.setTitle("Username & email required", for: .normal)
                self.recoverButton.tintColor = .systemRed
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    self.recoverButton.setTitle("Recover Username", for: .normal)
                    self.recoverButton.tintColor = .systemOrange
                }
                return
            }
            self.doRecoverUsername(publicKey: key, username: username, email: email)
        })
        present(alert, animated: true)
    }

    private func doRecoverUsername(publicKey: String, username: String, email: String) {
        let signature: String
        do {
            let message = "keywitness:recover:\(username)"
            guard let data = message.data(using: .utf8) else { return }
            signature = try CryptoEngine.signBase64URL(data)
        } catch {
            NSLog("[KeyWitness] Failed to sign recovery: %@", error.localizedDescription)
            recoverButton.setTitle("Signing failed", for: .normal)
            recoverButton.tintColor = .systemRed
            return
        }

        // Step 1: Request recovery code (server sends email)
        let url = URL(string: "https://www.keywitness.io/api/usernames/recover")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = [
            "username": username,
            "newPublicKey": publicKey,
            "email": email,
            "signature": signature,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        recoverButton.isEnabled = false
        recoverButton.setTitle("Sending code...", for: .normal)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.recoverButton.isEnabled = true

                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode == 200,
                   error == nil {
                    // Step 2: Prompt for the emailed code
                    self.promptForRecoveryCode(publicKey: publicKey, username: username, signature: signature)
                } else {
                    var errorMsg = "Recovery failed"
                    if let data = data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let err = json["error"] as? String {
                        errorMsg = err
                    }
                    self.recoverButton.setTitle(errorMsg, for: .normal)
                    self.recoverButton.tintColor = .systemRed
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                        self.recoverButton.setTitle("Recover Username", for: .normal)
                        self.recoverButton.tintColor = .systemOrange
                    }
                }
            }
        }.resume()
    }

    private func promptForRecoveryCode(publicKey: String, username: String, signature: String) {
        let alert = UIAlertController(
            title: "Check Your Email",
            message: "We sent a 6-digit code to your recovery email. Enter it below.",
            preferredStyle: .alert
        )
        alert.addTextField { textField in
            textField.placeholder = "6-digit code"
            textField.keyboardType = .numberPad
            textField.textContentType = .oneTimeCode
        }
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.recoverButton.setTitle("Recover Username", for: .normal)
            self?.recoverButton.tintColor = .systemOrange
        })
        alert.addAction(UIAlertAction(title: "Verify", style: .default) { [weak self] _ in
            guard let self = self else { return }
            let code = alert.textFields?[0].text?.trimmingCharacters(in: .whitespaces) ?? ""
            guard code.count == 6 else {
                self.recoverButton.setTitle("Invalid code", for: .normal)
                self.recoverButton.tintColor = .systemRed
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    self.recoverButton.setTitle("Recover Username", for: .normal)
                    self.recoverButton.tintColor = .systemOrange
                }
                return
            }
            self.confirmRecoveryCode(publicKey: publicKey, username: username, code: code, signature: signature)
        })
        present(alert, animated: true)
    }

    private func confirmRecoveryCode(publicKey: String, username: String, code: String, signature: String) {
        let url = URL(string: "https://www.keywitness.io/api/usernames/recover/confirm")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let payload: [String: String] = [
            "username": username,
            "newPublicKey": publicKey,
            "code": code,
            "signature": signature,
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: payload)

        recoverButton.isEnabled = false
        recoverButton.setTitle("Verifying...", for: .normal)

        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.recoverButton.isEnabled = true

                if let httpResponse = response as? HTTPURLResponse,
                   httpResponse.statusCode == 200,
                   error == nil {
                    let defaults = UserDefaults(suiteName: "group.io.keywitness")
                    defaults?.set(username, forKey: "claimedUsername")
                    self.doRegisterName(publicKey: publicKey, name: username)
                    self.usernameStatusLabel.text = username
                    self.usernameStatusLabel.isHidden = false
                    self.registerKeyButton.setTitle("Change", for: .normal)
                    self.recoverButton.setTitle("Recovered!", for: .normal)
                    self.recoverButton.tintColor = .systemGreen
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                        self.recoverButton.setTitle("Recover Username", for: .normal)
                        self.recoverButton.tintColor = .systemOrange
                    }
                } else {
                    var errorMsg = "Verification failed"
                    if let data = data,
                       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                       let err = json["error"] as? String {
                        errorMsg = err
                    }
                    self.recoverButton.setTitle(errorMsg, for: .normal)
                    self.recoverButton.tintColor = .systemRed
                    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) {
                        self.recoverButton.setTitle("Recover Username", for: .normal)
                        self.recoverButton.tintColor = .systemOrange
                    }
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
            textView.text = "Switch to KeyWitness keyboard and start typing..."
            textView.textColor = .gray
        }
    }
}

// MARK: - BLEPeripheralDelegate

extension MainViewController: BLEPeripheralDelegate {
    func bleSessionStarted(_ session: BLESession) {
        bleStatusLabel.text = "Connected — listening for keystrokes"
        bleStatusLabel.textColor = .systemGreen
        bleKeystrokeCount.text = "0 keystrokes"
        bleKeystrokeCount.isHidden = false
    }

    func bleKeystrokeReceived(_ session: BLESession, count: Int) {
        bleKeystrokeCount.text = "\(count) keystroke\(count == 1 ? "" : "s")"
    }

    func bleAttestationRequested(_ session: BLESession, cleartext: String, cleartextHash: Data) {
        bleStatusLabel.text = "Attestation requested — confirm below"
        bleStatusLabel.textColor = .systemOrange
        bleAttestationFlow?.requestAttestation(session: session, cleartext: cleartext)
    }

    func bleSessionEnded() {
        bleStatusLabel.text = "Disconnected — waiting for connection…"
        bleStatusLabel.textColor = .systemYellow
        bleKeystrokeCount.isHidden = true
    }

    func bleAdvertisingStateChanged(advertising: Bool, error: String?) {
        if advertising {
            bleStatusLabel.text = "Advertising — waiting for connection…"
            bleStatusLabel.textColor = .systemYellow
        } else if let error = error {
            bleStatusLabel.text = "BLE error: \(error)"
            bleStatusLabel.textColor = .systemRed
            bleToggle.isOn = false
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
        NSLog("[KeyWitness] didReceive notification tap: userInfo=%@", "\(userInfo)")
        if let shortId = userInfo["shortId"] as? String {
            // Get cleartext from notification userInfo (preferred) or shared defaults (fallback)
            let cleartext = (userInfo["cleartext"] as? String)
                ?? UserDefaults(suiteName: "group.io.keywitness")?.string(forKey: "pendingBiometricCleartext")

            // Clean up so checkPendingBiometric doesn't also fire
            let defaults = UserDefaults(suiteName: "group.io.keywitness")
            defaults?.removeObject(forKey: "pendingBiometricShortId")
            defaults?.removeObject(forKey: "pendingBiometricCreatedAt")
            defaults?.removeObject(forKey: "pendingBiometricCleartext")

            // Delay — app may not be fully foregrounded yet
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
                self?.startLiveActivity(shortId: shortId, cleartext: cleartext)
            }
            showBiometricConfirmation(shortId: shortId, cleartext: cleartext)
        }
        completionHandler()
    }
}
