import UIKit

/// Full explanation of KeyWitness — all attestation modes, trust chain,
/// privacy model. Presented modally from the main screen.
class LearnMoreViewController: UIViewController {

    private let bgColor = UIColor(red: 0.04, green: 0.04, blue: 0.06, alpha: 1.0)
    private let cardColor = UIColor(red: 0.10, green: 0.10, blue: 0.12, alpha: 1.0)
    private let cardBorder = UIColor(red: 0.18, green: 0.18, blue: 0.22, alpha: 1.0)
    private let accentColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1.0)
    private let greenGlow = UIColor(red: 0.20, green: 0.83, blue: 0.47, alpha: 1.0)
    private let purpleAccent = UIColor(red: 0.60, green: 0.40, blue: 1.0, alpha: 1.0)
    private let orangeAccent = UIColor(red: 1.0, green: 0.60, blue: 0.25, alpha: 1.0)
    private let dimText = UIColor(white: 0.45, alpha: 1)
    private let bodyColor = UIColor(white: 0.65, alpha: 1)

    private let scrollView = UIScrollView()
    private let contentStack = UIStackView()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bgColor
        setupNav()
        setupScroll()
        buildContent()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Setup

    private func setupNav() {
        let closeButton = UIButton(type: .system)
        closeButton.setImage(UIImage(systemName: "xmark.circle.fill"), for: .normal)
        closeButton.tintColor = UIColor(white: 0.35, alpha: 1)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        closeButton.addTarget(self, action: #selector(closeTapped), for: .touchUpInside)
        view.addSubview(closeButton)
        NSLayoutConstraint.activate([
            closeButton.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            closeButton.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            closeButton.widthAnchor.constraint(equalToConstant: 32),
            closeButton.heightAnchor.constraint(equalToConstant: 32),
        ])
    }

    private func setupScroll() {
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 44),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
        ])

        contentStack.axis = .vertical
        contentStack.spacing = 24
        contentStack.alignment = .fill
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        scrollView.addSubview(contentStack)
        NSLayoutConstraint.activate([
            contentStack.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 8),
            contentStack.leadingAnchor.constraint(equalTo: scrollView.leadingAnchor, constant: 20),
            contentStack.trailingAnchor.constraint(equalTo: scrollView.trailingAnchor, constant: -20),
            contentStack.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -40),
            contentStack.widthAnchor.constraint(equalTo: scrollView.widthAnchor, constant: -40),
        ])
    }

    @objc private func closeTapped() {
        dismiss(animated: true)
    }

    // MARK: - Content

    private func buildContent() {
        addHeader()
        addSection(title: "The Problem",
                   body: "AI writes better prose than most people. Every text, email, and essay is suspect. Detection is a losing arms race — statistical guesses that degrade with every new model.\n\nKeyWitness takes a different approach: instead of detecting AI, we prove humanity. Cryptographic proof captured at the moment of input.")

        addSectionHeader("Three Ways to Attest")

        addModeCard(
            icon: "keyboard.fill",
            color: accentColor,
            title: "Typed Attestation",
            items: [
                "Type on the KeyWitness keyboard in any app",
                "Every keystroke is witnessed: timing, position, pressure, radius",
                "Tap Seal to build a cryptographic proof",
                "A W3C Verifiable Credential is signed in the Secure Enclave",
                "Your text is encrypted — the server can't read it",
                "Share the link. Anyone verifies in their browser.",
            ])

        addModeCard(
            icon: "waveform",
            color: purpleAccent,
            title: "Voice Attestation",
            items: [
                "Tap Speak Instead to record your voice",
                "On-device speech recognition transcribes your words",
                "Audio spectrograms and TrueDepth face tracking verify liveness",
                "The transcription becomes the attested text",
                "Proves a real human spoke these words on this device",
                "Same cryptographic seal as typed attestations",
            ])

        addModeCard(
            icon: "camera.fill",
            color: orangeAccent,
            title: "Photo Attestation",
            items: [
                "Tap Snap Instead to capture an unfiltered photo",
                "The image is hashed and signed — no filters, no edits",
                "Device attestation proves it came from a real camera",
                "Proves: this exact image was captured on this device at this time",
                "Useful for documenting evidence, conditions, or events",
            ])

        addModeCard(
            icon: "antenna.radiowaves.left.and.right",
            color: UIColor(red: 0.30, green: 0.75, blue: 0.85, alpha: 1.0),
            title: "Web Attestation (BLE)",
            items: [
                "Enable Bluetooth in the app to act as a trust anchor",
                "Type on any website — keystrokes stream to your phone via BLE",
                "Your iPhone reconstructs the text from raw keystrokes",
                "You confirm the text matches, then Face ID + sign",
                "The website gets a full attestation — no keyboard install needed",
                "Turns your iPhone into a hardware security key for any browser",
            ])

        addSectionHeader("The Trust Chain")

        addChainCard(items: [
            ("cpu", "Secure Enclave", "Ed25519 key generated in hardware. Private key never leaves the chip.", accentColor),
            ("keyboard.fill", "Keystroke Biometrics", "Timing, position, pressure hashed into the credential. Unique to the typist and the moment.", accentColor),
            ("checkmark.shield.fill", "Apple App Attest", "Apple certifies: real device, real app, not jailbroken, not a simulator.", greenGlow),
            ("faceid", "Face ID", "The phone's owner saw this exact message and approved it.", greenGlow),
            ("doc.text", "W3C Verifiable Credential", "Open standard (eddsa-jcs-2022). Self-contained. Any conforming verifier works.", purpleAccent),
            ("lock.shield.fill", "AES-256-GCM Encryption", "Text encrypted on-device. Key encoded as emoji in the URL. Server stores a blob it cannot read.", purpleAccent),
        ])

        addSectionHeader("Privacy")

        addSection(title: nil,
                   body: "The server cannot read your text — not because we promise, but because we architecturally can't. The encryption key lives in the URL fragment, which browsers never send to servers.\n\nNo accounts. No tracking. No analytics. No ads. The app is fully open source.")

        addSectionHeader("Open Standards")

        addBullets([
            "W3C Verifiable Credentials 2.0",
            "eddsa-jcs-2022 (Ed25519 + RFC 8785 JCS)",
            "did:key identifiers",
            "BitstringStatusList for revocation",
            "Apple App Attest (P-256 ECDSA, CBOR)",
        ])

        addSection(title: nil,
                   body: "Any conforming W3C VC verifier can validate a KeyWitness credential without knowing we exist. If KeyWitness disappeared, every seal ever created would still verify.")

        addFooter()
    }

    // MARK: - Component Builders

    private func addHeader() {
        let title = UILabel()
        title.text = "How KeyWitness Works"
        title.font = .systemFont(ofSize: 26, weight: .bold)
        title.textColor = .white
        contentStack.addArrangedSubview(title)
    }

    private func addSectionHeader(_ text: String) {
        let label = UILabel()
        label.text = text.uppercased()
        label.font = .systemFont(ofSize: 11, weight: .bold)
        label.textColor = dimText
        label.setContentHuggingPriority(.required, for: .vertical)
        contentStack.addArrangedSubview(label)
    }

    private func addSection(title: String?, body: String) {
        let card = makeCard()
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        if let title = title {
            let titleLabel = UILabel()
            titleLabel.text = title
            titleLabel.font = .systemFont(ofSize: 17, weight: .semibold)
            titleLabel.textColor = .white
            titleLabel.numberOfLines = 0
            stack.addArrangedSubview(titleLabel)
        }

        let bodyLabel = UILabel()
        bodyLabel.text = body
        bodyLabel.font = .systemFont(ofSize: 14, weight: .regular)
        bodyLabel.textColor = bodyColor
        bodyLabel.numberOfLines = 0
        stack.addArrangedSubview(bodyLabel)

        card.addSubview(stack)
        pinInCard(stack, card: card)
        contentStack.addArrangedSubview(card)
    }

    private func addModeCard(icon: String, color: UIColor, title: String, items: [String]) {
        let card = makeCard()

        // Header row
        let iconBg = UIView()
        iconBg.translatesAutoresizingMaskIntoConstraints = false
        iconBg.backgroundColor = color.withAlphaComponent(0.12)
        iconBg.layer.cornerRadius = 16
        iconBg.widthAnchor.constraint(equalToConstant: 32).isActive = true
        iconBg.heightAnchor.constraint(equalToConstant: 32).isActive = true

        let iconView = UIImageView(image: UIImage(systemName: icon))
        iconView.tintColor = color
        iconView.contentMode = .scaleAspectFit
        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconBg.addSubview(iconView)
        NSLayoutConstraint.activate([
            iconView.centerXAnchor.constraint(equalTo: iconBg.centerXAnchor),
            iconView.centerYAnchor.constraint(equalTo: iconBg.centerYAnchor),
            iconView.widthAnchor.constraint(equalToConstant: 16),
            iconView.heightAnchor.constraint(equalToConstant: 16),
        ])

        let titleLabel = UILabel()
        titleLabel.text = title
        titleLabel.font = .systemFont(ofSize: 16, weight: .semibold)
        titleLabel.textColor = .white

        let headerRow = UIStackView(arrangedSubviews: [iconBg, titleLabel])
        headerRow.axis = .horizontal
        headerRow.spacing = 10
        headerRow.alignment = .center

        // Items
        let itemsStack = UIStackView()
        itemsStack.axis = .vertical
        itemsStack.spacing = 8

        for text in items {
            let dot = UIView()
            dot.translatesAutoresizingMaskIntoConstraints = false
            dot.backgroundColor = color.withAlphaComponent(0.4)
            dot.layer.cornerRadius = 2.5
            dot.widthAnchor.constraint(equalToConstant: 5).isActive = true
            dot.heightAnchor.constraint(equalToConstant: 5).isActive = true

            let label = UILabel()
            label.text = text
            label.font = .systemFont(ofSize: 13, weight: .regular)
            label.textColor = bodyColor
            label.numberOfLines = 0

            let row = UIStackView(arrangedSubviews: [dot, label])
            row.axis = .horizontal
            row.spacing = 8
            row.alignment = .top

            // Vertically center dot with first line of text
            let dotWrap = UIView()
            dotWrap.translatesAutoresizingMaskIntoConstraints = false
            dotWrap.addSubview(dot)
            NSLayoutConstraint.activate([
                dot.leadingAnchor.constraint(equalTo: dotWrap.leadingAnchor),
                dot.trailingAnchor.constraint(equalTo: dotWrap.trailingAnchor),
                dot.topAnchor.constraint(equalTo: dotWrap.topAnchor, constant: 6),
                dotWrap.widthAnchor.constraint(equalToConstant: 5),
                dotWrap.heightAnchor.constraint(greaterThanOrEqualToConstant: 5),
            ])

            let itemRow = UIStackView(arrangedSubviews: [dotWrap, label])
            itemRow.axis = .horizontal
            itemRow.spacing = 8
            itemRow.alignment = .top
            itemsStack.addArrangedSubview(itemRow)
        }

        let stack = UIStackView(arrangedSubviews: [headerRow, itemsStack])
        stack.axis = .vertical
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)
        pinInCard(stack, card: card)
        contentStack.addArrangedSubview(card)
    }

    private func addChainCard(items: [(String, String, String, UIColor)]) {
        let card = makeCard()

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false

        for (i, item) in items.enumerated() {
            let (icon, title, body, color) = item
            let isLast = i == items.count - 1

            let row = UIView()
            row.translatesAutoresizingMaskIntoConstraints = false

            // Dot
            let dot = UIView()
            dot.translatesAutoresizingMaskIntoConstraints = false
            dot.backgroundColor = color
            dot.layer.cornerRadius = 4
            dot.layer.shadowColor = color.cgColor
            dot.layer.shadowRadius = 3
            dot.layer.shadowOpacity = 0.4
            dot.layer.shadowOffset = .zero

            // Line
            let line = UIView()
            line.translatesAutoresizingMaskIntoConstraints = false
            line.backgroundColor = UIColor(white: 1, alpha: 0.06)
            line.isHidden = isLast

            // Icon
            let iv = UIImageView(image: UIImage(systemName: icon))
            iv.translatesAutoresizingMaskIntoConstraints = false
            iv.tintColor = color.withAlphaComponent(0.6)
            iv.contentMode = .scaleAspectFit

            // Labels
            let titleLabel = UILabel()
            titleLabel.text = title
            titleLabel.font = .systemFont(ofSize: 14, weight: .semibold)
            titleLabel.textColor = .white

            let bodyLabel = UILabel()
            bodyLabel.text = body
            bodyLabel.font = .systemFont(ofSize: 12, weight: .regular)
            bodyLabel.textColor = UIColor(white: 0.50, alpha: 1)
            bodyLabel.numberOfLines = 0

            let textStack = UIStackView(arrangedSubviews: [titleLabel, bodyLabel])
            textStack.axis = .vertical
            textStack.spacing = 2
            textStack.translatesAutoresizingMaskIntoConstraints = false

            row.addSubview(line)
            row.addSubview(dot)
            row.addSubview(iv)
            row.addSubview(textStack)

            NSLayoutConstraint.activate([
                dot.widthAnchor.constraint(equalToConstant: 8),
                dot.heightAnchor.constraint(equalToConstant: 8),
                dot.leadingAnchor.constraint(equalTo: row.leadingAnchor),
                dot.topAnchor.constraint(equalTo: row.topAnchor, constant: 5),

                line.widthAnchor.constraint(equalToConstant: 1),
                line.centerXAnchor.constraint(equalTo: dot.centerXAnchor),
                line.topAnchor.constraint(equalTo: dot.bottomAnchor, constant: 3),
                line.bottomAnchor.constraint(equalTo: row.bottomAnchor),

                iv.widthAnchor.constraint(equalToConstant: 14),
                iv.heightAnchor.constraint(equalToConstant: 14),
                iv.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 10),
                iv.topAnchor.constraint(equalTo: row.topAnchor, constant: 2),

                textStack.leadingAnchor.constraint(equalTo: iv.trailingAnchor, constant: 8),
                textStack.trailingAnchor.constraint(equalTo: row.trailingAnchor),
                textStack.topAnchor.constraint(equalTo: row.topAnchor),
                textStack.bottomAnchor.constraint(equalTo: row.bottomAnchor, constant: isLast ? 0 : -12),
            ])

            stack.addArrangedSubview(row)
        }

        card.addSubview(stack)
        pinInCard(stack, card: card)
        contentStack.addArrangedSubview(card)
    }

    private func addBullets(_ items: [String]) {
        let card = makeCard()
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false

        for text in items {
            let label = UILabel()
            label.text = "· \(text)"
            label.font = .monospacedSystemFont(ofSize: 13, weight: .regular)
            label.textColor = bodyColor
            label.numberOfLines = 0
            stack.addArrangedSubview(label)
        }

        card.addSubview(stack)
        pinInCard(stack, card: card)
        contentStack.addArrangedSubview(card)
    }

    private func addFooter() {
        let label = UILabel()
        label.text = "Open source at github.com/magicseth/keywitness"
        label.font = .systemFont(ofSize: 11, weight: .regular)
        label.textColor = UIColor(white: 0.25, alpha: 1)
        label.textAlignment = .center
        contentStack.addArrangedSubview(label)
    }

    // MARK: - Helpers

    private func makeCard() -> UIView {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 14
        card.layer.borderWidth = 0.5
        card.layer.borderColor = cardBorder.cgColor
        card.translatesAutoresizingMaskIntoConstraints = false
        return card
    }

    private func pinInCard(_ stack: UIView, card: UIView) {
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])
    }
}
