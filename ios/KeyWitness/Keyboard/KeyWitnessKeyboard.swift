import UIKit
import UserNotifications

/// KeyWitnessKeyboard is the main UIInputViewController for the KeyWitness
/// custom keyboard extension. It renders a QWERTY layout with touch biometric
/// capture and an Attest button that signs the typed text.
///
/// NOTE: Networking requires `RequestsOpenAccess = true` in Info.plist AND the
/// user must grant "Allow Full Access" in Settings > General > Keyboard > KeyWitness.
/// Without full access, URLSession requests from the keyboard extension will fail silently.
class KeyWitnessKeyboard: UIInputViewController {

    // MARK: - Configuration

    /// Base URL for the KeyWitness API. Change this for development/staging environments.
    static var serverBaseURL = "https://www.keywitness.io"

    // MARK: - State

    private var keystrokeEvents: [KeystrokeEvent] = []
    private var pendingTouches: [UIButton: (key: String, downTime: TimeInterval, x: CGFloat, y: CGFloat, force: CGFloat, radius: CGFloat)] = [:]
    private var isShifted = false
    private weak var attestButton: UIButton?
    private weak var faceButton: UIButton?
    private var lockOverlay: UIView?
    private var isUnlocked = false

    // MARK: - Biometric Session

    /// Seconds since last biometric verification, or nil if never verified.
    private var biometricAge: TimeInterval? {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        guard let timestamp = defaults?.object(forKey: "faceIdVerifiedAt") as? Date else {
            return nil
        }
        return Date().timeIntervalSince(timestamp)
    }

    /// Whether biometric session is valid for general keyboard use (10 min).
    private var sessionValid: Bool {
        guard let age = biometricAge else { return false }
        return age < 600
    }

    /// Whether a one-time attest token is available and within the 2-minute window.
    private var hasAttestToken: Bool {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        guard let created = defaults?.object(forKey: "attestTokenCreatedAt") as? Date else {
            return false
        }
        let age = Date().timeIntervalSince(created)
        // Enforce 2-minute expiry
        return age < 120
    }

    /// Consume the one-time attest token.
    private func consumeAttestToken() {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        defaults?.removeObject(forKey: "attestTokenCreatedAt")
    }

    /// Whether biometric was verified at all (for the faceIdVerified flag in attestation).
    private var sessionFaceIdVerified: Bool {
        return sessionValid
    }

    // MARK: - Layout Constants

    private let keyboardBackground  = UIColor(red: 0.11, green: 0.11, blue: 0.12, alpha: 1.0)
    private let keyBackground       = UIColor(red: 0.25, green: 0.25, blue: 0.27, alpha: 1.0)
    private let specialKeyBackground = UIColor(red: 0.18, green: 0.18, blue: 0.20, alpha: 1.0)
    private let attestBackground    = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1.0)
    private let keyTextColor        = UIColor.white
    private let keyCornerRadius: CGFloat = 5.0
    private let rowSpacing: CGFloat = 8.0
    private let keySpacing: CGFloat = 6.0
    private let keyHeight: CGFloat  = 42.0

    // MARK: - Row Definitions

    private let letterRows: [[String]] = [
        ["Q","W","E","R","T","Y","U","I","O","P"],
        ["A","S","D","F","G","H","J","K","L"],
        ["Z","X","C","V","B","N","M"]
    ]

    // MARK: - UI References

    private var rowStackView: UIStackView!

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        setupKeyboard()
        setupLockOverlay()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // Re-check biometric session each time keyboard appears
        if sessionValid {
            unlockKeyboard(animated: false)
        } else {
            showLockOverlay(animated: false)
        }
        updateFaceButtonState()
    }

    // MARK: - Lock Overlay

    private func setupLockOverlay() {
        guard let inputView = self.inputView else { return }

        let overlay = UIView()
        overlay.backgroundColor = keyboardBackground
        overlay.translatesAutoresizingMaskIntoConstraints = false
        inputView.addSubview(overlay)
        NSLayoutConstraint.activate([
            overlay.topAnchor.constraint(equalTo: inputView.topAnchor),
            overlay.leadingAnchor.constraint(equalTo: inputView.leadingAnchor),
            overlay.trailingAnchor.constraint(equalTo: inputView.trailingAnchor),
            overlay.bottomAnchor.constraint(equalTo: inputView.bottomAnchor),
        ])

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        stack.alignment = .center
        stack.translatesAutoresizingMaskIntoConstraints = false
        overlay.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: overlay.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: overlay.centerYAnchor),
        ])

        // Shield + key icon (SF Symbol or text fallback)
        let iconLabel = UILabel()
        iconLabel.text = "🔐"
        iconLabel.font = UIFont.systemFont(ofSize: 36)
        stack.addArrangedSubview(iconLabel)

        let titleLabel = UILabel()
        titleLabel.text = "KeyWitness"
        titleLabel.font = UIFont.systemFont(ofSize: 18, weight: .semibold)
        titleLabel.textColor = .white
        stack.addArrangedSubview(titleLabel)

        let subtitleLabel = UILabel()
        subtitleLabel.text = "Tap to unlock with Face ID / Touch ID"
        subtitleLabel.font = UIFont.systemFont(ofSize: 13)
        subtitleLabel.textColor = UIColor.lightGray
        stack.addArrangedSubview(subtitleLabel)

        let tapGesture = UITapGestureRecognizer(target: self, action: #selector(lockOverlayTapped))
        overlay.addGestureRecognizer(tapGesture)

        self.lockOverlay = overlay
        overlay.isHidden = sessionValid
        isUnlocked = sessionValid
    }

    @objc private func lockOverlayTapped() {
        if sessionValid {
            unlockKeyboard(animated: true)
        } else {
            // Update subtitle to direct user to the app
            if let stack = lockOverlay?.subviews.first(where: { $0 is UIStackView }) as? UIStackView,
               let subtitle = stack.arrangedSubviews.last as? UILabel {
                subtitle.text = "Open KeyWitness app to verify"
                subtitle.textColor = UIColor(red: 1.0, green: 0.6, blue: 0.2, alpha: 1.0)
                DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
                    subtitle.text = "Tap to unlock with Face ID / Touch ID"
                    subtitle.textColor = .lightGray
                }
            }
        }
    }

    private func unlockKeyboard(animated: Bool) {
        isUnlocked = true
        if animated {
            UIView.animate(withDuration: 0.2) {
                self.lockOverlay?.alpha = 0
            } completion: { _ in
                self.lockOverlay?.isHidden = true
                self.lockOverlay?.alpha = 1
            }
        } else {
            lockOverlay?.isHidden = true
        }
    }

    private func showLockOverlay(animated: Bool) {
        isUnlocked = false
        lockOverlay?.isHidden = false
        if animated {
            lockOverlay?.alpha = 0
            UIView.animate(withDuration: 0.2) {
                self.lockOverlay?.alpha = 1
            }
        }
    }

    // MARK: - Keyboard Setup

    private func setupKeyboard() {
        guard let inputView = self.inputView else { return }
        inputView.backgroundColor = keyboardBackground
        inputView.allowsSelfSizing = true

        let container = UIStackView()
        container.axis = .vertical
        container.spacing = rowSpacing
        container.alignment = .fill
        container.distribution = .fill
        container.translatesAutoresizingMaskIntoConstraints = false

        inputView.addSubview(container)
        NSLayoutConstraint.activate([
            container.topAnchor.constraint(equalTo: inputView.topAnchor, constant: 8),
            container.leadingAnchor.constraint(equalTo: inputView.leadingAnchor, constant: 3),
            container.trailingAnchor.constraint(equalTo: inputView.trailingAnchor, constant: -3),
            container.bottomAnchor.constraint(equalTo: inputView.bottomAnchor, constant: -4)
        ])

        // Row 1: Q W E R T Y U I O P
        container.addArrangedSubview(makeLetterRow(letterRows[0]))

        // Row 2: A S D F G H J K L (inset slightly)
        let row2 = makeLetterRow(letterRows[1])
        let row2Wrapper = wrapWithInsets(row2, leading: 16, trailing: 16)
        container.addArrangedSubview(row2Wrapper)

        // Row 3: Shift + Z X C V B N M + Delete
        container.addArrangedSubview(makeThirdRow())

        // Row 4: Globe / 123 / Space / Attest / Return
        container.addArrangedSubview(makeBottomRow())

        rowStackView = container
    }

    // MARK: - Row Builders

    private func makeLetterRow(_ letters: [String]) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = keySpacing
        row.distribution = .fillEqually
        row.alignment = .fill

        for letter in letters {
            let btn = makeKeyButton(title: letter)
            btn.addTarget(self, action: #selector(keyTouchDown(_:event:)), for: .touchDown)
            btn.addTarget(self, action: #selector(keyTouchUp(_:event:)), for: [.touchUpInside, .touchUpOutside])
            btn.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
            row.addArrangedSubview(btn)
        }
        return row
    }

    private func makeThirdRow() -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = keySpacing
        row.distribution = .fill
        row.alignment = .fill

        // Shift button
        let shift = makeKeyButton(title: "\u{21E7}", background: specialKeyBackground)
        shift.addTarget(self, action: #selector(shiftTapped), for: .touchUpInside)
        shift.widthAnchor.constraint(equalToConstant: 42).isActive = true
        shift.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        row.addArrangedSubview(shift)

        // Letter keys
        let lettersStack = UIStackView()
        lettersStack.axis = .horizontal
        lettersStack.spacing = keySpacing
        lettersStack.distribution = .fillEqually

        for letter in letterRows[2] {
            let btn = makeKeyButton(title: letter)
            btn.addTarget(self, action: #selector(keyTouchDown(_:event:)), for: .touchDown)
            btn.addTarget(self, action: #selector(keyTouchUp(_:event:)), for: [.touchUpInside, .touchUpOutside])
            btn.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
            lettersStack.addArrangedSubview(btn)
        }
        row.addArrangedSubview(lettersStack)

        // Delete button
        let delete = makeKeyButton(title: "\u{232B}", background: specialKeyBackground)
        delete.addTarget(self, action: #selector(deleteTapped), for: .touchUpInside)
        delete.widthAnchor.constraint(equalToConstant: 42).isActive = true
        delete.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        row.addArrangedSubview(delete)

        return row
    }

    private func makeBottomRow() -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = keySpacing
        row.distribution = .fill
        row.alignment = .fill

        // Next keyboard button (globe)
        let globe = makeKeyButton(title: "\u{1F310}", background: specialKeyBackground)
        globe.addTarget(self, action: #selector(handleInputModeList(from:with:)), for: .allTouchEvents)
        globe.widthAnchor.constraint(equalToConstant: 38).isActive = true
        globe.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        row.addArrangedSubview(globe)

        // Space bar
        let space = makeKeyButton(title: "space", background: keyBackground)
        space.addTarget(self, action: #selector(keyTouchDown(_:event:)), for: .touchDown)
        space.addTarget(self, action: #selector(keyTouchUp(_:event:)), for: [.touchUpInside, .touchUpOutside])
        space.accessibilityIdentifier = "space"
        space.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        row.addArrangedSubview(space)

        // Face ID / Touch ID button
        let faceBtn = makeKeyButton(title: "🔒", background: specialKeyBackground)
        faceBtn.addTarget(self, action: #selector(faceTapped), for: .touchUpInside)
        faceBtn.widthAnchor.constraint(equalToConstant: 38).isActive = true
        faceBtn.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        self.faceButton = faceBtn
        row.addArrangedSubview(faceBtn)

        // Attest button
        let attest = makeKeyButton(title: "Attest", background: attestBackground)
        attest.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        attest.addTarget(self, action: #selector(attestTapped), for: .touchUpInside)
        attest.widthAnchor.constraint(equalToConstant: 72).isActive = true
        attest.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        self.attestButton = attest
        row.addArrangedSubview(attest)

        // Return
        let returnBtn = makeKeyButton(title: "return", background: specialKeyBackground)
        returnBtn.titleLabel?.font = UIFont.systemFont(ofSize: 15, weight: .regular)
        returnBtn.addTarget(self, action: #selector(returnTapped), for: .touchUpInside)
        returnBtn.widthAnchor.constraint(equalToConstant: 72).isActive = true
        returnBtn.heightAnchor.constraint(equalToConstant: keyHeight).isActive = true
        row.addArrangedSubview(returnBtn)

        return row
    }

    // MARK: - Key Button Factory

    private func makeKeyButton(title: String, background: UIColor? = nil) -> UIButton {
        let btn = UIButton(type: .custom)
        btn.setTitle(title, for: .normal)
        btn.setTitleColor(keyTextColor, for: .normal)
        btn.backgroundColor = background ?? keyBackground
        btn.layer.cornerRadius = keyCornerRadius
        btn.layer.shadowColor = UIColor.black.cgColor
        btn.layer.shadowOffset = CGSize(width: 0, height: 1)
        btn.layer.shadowOpacity = 0.35
        btn.layer.shadowRadius = 0.5
        btn.titleLabel?.font = UIFont.systemFont(ofSize: 22, weight: .light)
        btn.translatesAutoresizingMaskIntoConstraints = false
        return btn
    }

    private func wrapWithInsets(_ view: UIView, leading: CGFloat, trailing: CGFloat) -> UIView {
        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        view.translatesAutoresizingMaskIntoConstraints = false
        wrapper.addSubview(view)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: wrapper.topAnchor),
            view.bottomAnchor.constraint(equalTo: wrapper.bottomAnchor),
            view.leadingAnchor.constraint(equalTo: wrapper.leadingAnchor, constant: leading),
            view.trailingAnchor.constraint(equalTo: wrapper.trailingAnchor, constant: -trailing)
        ])
        return wrapper
    }

    // MARK: - Touch Tracking

    @objc private func keyTouchDown(_ sender: UIButton, event: UIEvent) {
        let now = ProcessInfo.processInfo.systemUptime
        var touchX: CGFloat = 0
        var touchY: CGFloat = 0
        var touchForce: CGFloat = 0
        var touchRadius: CGFloat = 0

        if let touch = event.allTouches?.first {
            let loc = touch.location(in: sender)
            touchX = loc.x
            touchY = loc.y
            touchForce = touch.force
            touchRadius = touch.majorRadius
        }

        let key = resolveKeyLabel(sender)

        pendingTouches[sender] = (
            key: key,
            downTime: now,
            x: touchX,
            y: touchY,
            force: touchForce,
            radius: touchRadius
        )

        // Visual feedback
        UIView.animate(withDuration: 0.05) {
            sender.alpha = 0.6
        }
    }

    @objc private func keyTouchUp(_ sender: UIButton, event: UIEvent) {
        let now = ProcessInfo.processInfo.systemUptime

        // Visual feedback restore
        UIView.animate(withDuration: 0.1) {
            sender.alpha = 1.0
        }

        guard let pending = pendingTouches.removeValue(forKey: sender) else { return }

        let keystroke = KeystrokeEvent(
            key: pending.key,
            touchDownTime: pending.downTime,
            touchUpTime: now,
            x: pending.x,
            y: pending.y,
            force: pending.force,
            majorRadius: pending.radius
        )
        keystrokeEvents.append(keystroke)

        // Insert the character
        let charToInsert: String
        if pending.key == "space" {
            charToInsert = " "
        } else {
            charToInsert = isShifted ? pending.key.uppercased() : pending.key.lowercased()
        }

        textDocumentProxy.insertText(charToInsert)

        // Auto-unshift after one letter
        if isShifted && pending.key != "space" {
            isShifted = false
            updateShiftAppearance()
        }
    }

    /// Determines the logical key label from the button.
    private func resolveKeyLabel(_ button: UIButton) -> String {
        if button.accessibilityIdentifier == "space" {
            return "space"
        }
        return button.title(for: .normal) ?? ""
    }

    // MARK: - Special Key Actions

    @objc private func shiftTapped() {
        isShifted.toggle()
        updateShiftAppearance()
    }

    @objc private func deleteTapped() {
        textDocumentProxy.deleteBackward()
    }

    @objc private func returnTapped() {
        textDocumentProxy.insertText("\n")
    }

    private func updateShiftAppearance() {
        // Walk through all letter keys and update case
        guard let container = rowStackView else { return }
        for case let rowView in container.arrangedSubviews {
            updateButtonCases(in: rowView)
        }
    }

    private func updateButtonCases(in view: UIView) {
        if let btn = view as? UIButton,
           let title = btn.title(for: .normal),
           title.count == 1, title.first?.isLetter == true {
            let newTitle = isShifted ? title.uppercased() : title.lowercased()
            btn.setTitle(newTitle, for: .normal)
        }
        for sub in view.subviews {
            updateButtonCases(in: sub)
        }
    }

    // MARK: - Face ID Notification

    @objc private func faceTapped() {
        if hasAttestToken {
            // Already verified — flash green
            faceButton?.setTitle("✅", for: .normal)
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
                self.updateFaceButtonState()
            }
            return
        }

        // Send a local notification that opens the container app
        let content = UNMutableNotificationContent()
        content.title = "KeyWitness"
        content.body = "Tap to verify Face ID / Touch ID for attestation"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "keywitness-faceid-\(UUID().uuidString)",
            content: content,
            trigger: nil  // deliver immediately
        )

        UNUserNotificationCenter.current().add(request) { [weak self] error in
            DispatchQueue.main.async {
                if error == nil {
                    self?.faceButton?.setTitle("📤", for: .normal)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                        self?.updateFaceButtonState()
                    }
                }
            }
        }
    }

    private func updateFaceButtonState() {
        faceButton?.setTitle(hasAttestToken ? "🔓" : "🔒", for: .normal)
    }

    // MARK: - Attestation

    @objc private func attestTapped() {
        // Gather the full cleartext from the text document proxy
        let beforeCursor = textDocumentProxy.documentContextBeforeInput ?? ""
        let afterCursor = textDocumentProxy.documentContextAfterInput ?? ""
        let cleartext = beforeCursor + afterCursor

        guard !cleartext.isEmpty else { return }

        setAttestButtonLoading(true)

        // Consume the one-time attest token if available
        let faceIdVerified = hasAttestToken
        if faceIdVerified {
            consumeAttestToken()
            updateFaceButtonState()
        }

        do {
            let (attestationBlock, encryptionKey) = try AttestationBuilder.createAttestation(
                cleartext: cleartext,
                keystrokeEvents: keystrokeEvents,
                faceIdVerified: faceIdVerified
            )

            uploadAttestation(attestationBlock, encryptionKey: encryptionKey) { [weak self] result in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.setAttestButtonLoading(false)

                    switch result {
                    case .success(let url):
                        let before = self.textDocumentProxy.documentContextBeforeInput ?? ""
                        if !before.isEmpty && !before.hasSuffix(" ") && !before.hasSuffix("\n") {
                            self.textDocumentProxy.insertText(" ")
                        }
                        // Strip https://www. prefix for cleaner links
                        let shortURL = url
                            .replacingOccurrences(of: "https://www.", with: "")
                            .replacingOccurrences(of: "https://", with: "")
                        self.textDocumentProxy.insertText(shortURL)
                    case .failure:
                        self.textDocumentProxy.insertText("\n\n" + attestationBlock)
                    }
                    self.keystrokeEvents.removeAll()
                }
            }
        } catch {
            setAttestButtonLoading(false)
            textDocumentProxy.insertText("\n[Attestation error: \(error.localizedDescription)]")
        }
    }

    // MARK: - Upload Helper

    /// Uploads the attestation block to the KeyWitness server.
    ///
    /// Requires `RequestsOpenAccess = true` in Info.plist and "Allow Full Access"
    /// enabled by the user in Settings > General > Keyboard > KeyWitness.
    ///
    /// - Parameters:
    ///   - attestationBlock: The PEM-style attestation text block.
    ///   - encryptionKey: The base64url-encoded AES key, appended as a URL fragment.
    ///   - completion: Called with `.success(url)` or `.failure(error)`.
    private func uploadAttestation(_ attestationBlock: String,
                                   encryptionKey: String,
                                   completion: @escaping (Result<String, Error>) -> Void) {
        let endpoint = Self.serverBaseURL + "/api/attestations"

        guard let url = URL(string: endpoint) else {
            completion(.failure(UploadError.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: String] = ["attestation": attestationBlock]
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(.failure(error))
            return
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode),
                  let data = data else {
                completion(.failure(UploadError.serverError))
                return
            }

            do {
                if let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                   let attestationURL = json["url"] as? String {
                    // Append encryption key as URL fragment — the server never sees it
                    completion(.success(attestationURL + "#" + encryptionKey))
                } else {
                    completion(.failure(UploadError.unexpectedResponse))
                }
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }

    // MARK: - Attest Button Loading State

    private func setAttestButtonLoading(_ loading: Bool) {
        attestButton?.setTitle(loading ? "..." : "Attest", for: .normal)
        attestButton?.isEnabled = !loading
        attestButton?.alpha = loading ? 0.6 : 1.0
    }
}

// MARK: - Upload Errors

private enum UploadError: Error, LocalizedError {
    case invalidURL
    case serverError
    case unexpectedResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .serverError:
            return "Server returned an error"
        case .unexpectedResponse:
            return "Unexpected server response"
        }
    }
}
