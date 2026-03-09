import UIKit

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
    static var serverBaseURL = "https://quick-curlew-492.convex.site"

    // MARK: - State

    private var keystrokeEvents: [KeystrokeEvent] = []
    private var pendingTouches: [UIButton: (key: String, downTime: TimeInterval, x: CGFloat, y: CGFloat, force: CGFloat, radius: CGFloat)] = [:]
    /// Whether Face ID was verified in the container app (read from App Group).
    private var sessionFaceIdVerified: Bool {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        guard let timestamp = defaults?.object(forKey: "faceIdVerifiedAt") as? Date else {
            return false
        }
        // Face ID session is valid for 10 minutes
        return Date().timeIntervalSince(timestamp) < 600
    }
    private var isShifted = false
    private weak var attestButton: UIButton?

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

    // MARK: - Attestation

    @objc private func attestTapped() {
        // Gather the full cleartext from the text document proxy
        let beforeCursor = textDocumentProxy.documentContextBeforeInput ?? ""
        let afterCursor = textDocumentProxy.documentContextAfterInput ?? ""
        let cleartext = beforeCursor + afterCursor

        guard !cleartext.isEmpty else { return }

        setAttestButtonLoading(true)

        // Check if Face ID was verified in the container app (via App Group)
        let faceIdVerified = sessionFaceIdVerified

        do {
            let attestationBlock = try AttestationBuilder.createAttestation(
                cleartext: cleartext,
                keystrokeEvents: keystrokeEvents,
                faceIdVerified: faceIdVerified
            )

            uploadAttestation(attestationBlock) { [weak self] result in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.setAttestButtonLoading(false)

                    switch result {
                    case .success(let url):
                        let before = self.textDocumentProxy.documentContextBeforeInput ?? ""
                        if !before.isEmpty && !before.hasSuffix(" ") && !before.hasSuffix("\n") {
                            self.textDocumentProxy.insertText(" ")
                        }
                        self.textDocumentProxy.insertText(url)
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
    ///   - completion: Called with `.success(url)` or `.failure(error)`.
    private func uploadAttestation(_ attestationBlock: String,
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
                    completion(.success(attestationURL))
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
