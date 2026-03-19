import UIKit
import LocalAuthentication

/// Premium onboarding flow — 5 pages with scroll-driven parallax,
/// glowing accents, and staggered reveal animations.
class OnboardingViewController: UIViewController {

    // MARK: - Public

    var onComplete: (() -> Void)?

    // MARK: - Constants

    private let totalPages = 5
    private let bgColor = UIColor(red: 0.04, green: 0.04, blue: 0.06, alpha: 1.0)
    private let cardColor = UIColor(red: 0.10, green: 0.10, blue: 0.12, alpha: 1.0)
    private let accentColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1.0)
    private let greenGlow = UIColor(red: 0.20, green: 0.83, blue: 0.47, alpha: 1.0)
    private let dimText = UIColor(white: 0.45, alpha: 1)
    private let bodyText = UIColor(white: 0.70, alpha: 1)

    // MARK: - UI

    private let scrollView = UIScrollView()
    private let pageControl = UIPageControl()

    // Page 1 state
    private var keyboardDetectedIcon: UIImageView?
    private var keyboardDetectedLabel: UILabel?
    private var keyboardCheckTimer: Timer?

    // Page 3 state
    private var faceIDStatusIcon: UIImageView?
    private var faceIDStatusLabel: UILabel?
    private var faceIDEnabled = false

    // Track which pages have animated in
    private var animatedPages: Set<Int> = []

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bgColor
        setupScrollView()
        setupPageControl()
        buildPages()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        animatePageIn(0)
        startKeyboardCheck()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        keyboardCheckTimer?.invalidate()
        keyboardCheckTimer = nil
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Scroll scaffolding

    private func setupScrollView() {
        scrollView.isPagingEnabled = true
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.showsVerticalScrollIndicator = false
        scrollView.bounces = false
        scrollView.delegate = self
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scrollView)
        NSLayoutConstraint.activate([
            scrollView.topAnchor.constraint(equalTo: view.topAnchor),
            scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func setupPageControl() {
        pageControl.numberOfPages = totalPages
        pageControl.currentPage = 0
        pageControl.currentPageIndicatorTintColor = .white
        pageControl.pageIndicatorTintColor = UIColor.white.withAlphaComponent(0.15)
        pageControl.translatesAutoresizingMaskIntoConstraints = false
        pageControl.isUserInteractionEnabled = false
        view.addSubview(pageControl)
        NSLayoutConstraint.activate([
            pageControl.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            pageControl.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width
        let h = view.bounds.height
        scrollView.contentSize = CGSize(width: w * CGFloat(totalPages), height: h)
        for sub in scrollView.subviews where sub.tag >= 100 {
            let page = sub.tag - 100
            sub.frame = CGRect(x: w * CGFloat(page), y: 0, width: w, height: h)
        }
    }

    // MARK: - Page animation

    private func animatePageIn(_ page: Int) {
        guard !animatedPages.contains(page) else { return }
        animatedPages.insert(page)

        guard let container = scrollView.subviews.first(where: { $0.tag == 100 + page }) else { return }

        // Find the content stack (tag 200+page)
        guard let stack = container.viewWithTag(200 + page) as? UIStackView else { return }

        // Stagger children
        for (i, child) in stack.arrangedSubviews.enumerated() {
            child.alpha = 0
            child.transform = CGAffineTransform(translationX: 0, y: 24)
            UIView.animate(
                withDuration: 0.6,
                delay: Double(i) * 0.08,
                usingSpringWithDamping: 0.85,
                initialSpringVelocity: 0,
                options: [],
                animations: {
                    child.alpha = 1
                    child.transform = .identity
                }
            )
        }

        // Buttons fade in
        for sub in container.subviews where sub is UIButton || sub.tag == 300 {
            sub.alpha = 0
            UIView.animate(withDuration: 0.5, delay: 0.3) {
                sub.alpha = 1
            }
        }
    }

    // MARK: - Page construction

    private func buildPages() {
        buildWelcome()
        buildAddKeyboard()
        buildFullAccess()
        buildFaceID()
        buildDone()
    }

    // ── Page 0: Welcome ─────────────────────────────────────

    private func buildWelcome() {
        let container = makePageContainer(index: 0)

        // Glow circle behind icon
        let glowBg = UIView()
        glowBg.translatesAutoresizingMaskIntoConstraints = false
        glowBg.backgroundColor = accentColor.withAlphaComponent(0.08)
        glowBg.layer.cornerRadius = 48
        let icon = makeSFIcon("checkmark.seal.fill", size: 56, color: accentColor)
        icon.translatesAutoresizingMaskIntoConstraints = false

        let iconContainer = UIView()
        iconContainer.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.addSubview(glowBg)
        iconContainer.addSubview(icon)
        NSLayoutConstraint.activate([
            glowBg.widthAnchor.constraint(equalToConstant: 96),
            glowBg.heightAnchor.constraint(equalToConstant: 96),
            glowBg.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            glowBg.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            icon.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            iconContainer.heightAnchor.constraint(equalToConstant: 96),
        ])

        let title = makeTitle("KeyWitness")
        let subtitle = makeTagline("Cryptographic proof of human input")
        let body = makeBody("Every message you seal carries verifiable evidence it was typed by a real person on a real device — not AI.")

        let stack = makeContentStack([iconContainer, title, subtitle, spacer(20), body], tag: 200)
        let button = makePrimaryButton("Get Started", action: #selector(nextPage))

        container.addSubview(stack)
        container.addSubview(button)
        pinContentStack(stack, in: container)
        pinBottomButton(button, in: container)
    }

    // ── Page 1: Add Keyboard ────────────────────────────────

    private func buildAddKeyboard() {
        let container = makePageContainer(index: 1)

        let icon = makeSFIcon("keyboard.fill", size: 44, color: accentColor)
        let iconWrap = wrapIcon(icon)
        let title = makeTitle("Add the Keyboard")

        let steps = makeStepsCard([
            ("1", "Settings → General → Keyboard → Keyboards"),
            ("2", "Tap \"Add New Keyboard...\""),
            ("3", "Select KeyWitness"),
        ])

        // Detection indicator
        let detectedIcon = UIImageView(image: UIImage(systemName: "circle.dashed"))
        detectedIcon.tintColor = dimText
        detectedIcon.contentMode = .scaleAspectFit
        detectedIcon.translatesAutoresizingMaskIntoConstraints = false
        detectedIcon.widthAnchor.constraint(equalToConstant: 22).isActive = true
        detectedIcon.heightAnchor.constraint(equalToConstant: 22).isActive = true
        self.keyboardDetectedIcon = detectedIcon

        let detectedLabel = UILabel()
        detectedLabel.text = "Not yet detected"
        detectedLabel.font = .systemFont(ofSize: 14, weight: .medium)
        detectedLabel.textColor = dimText
        self.keyboardDetectedLabel = detectedLabel

        let detectedRow = UIStackView(arrangedSubviews: [detectedIcon, detectedLabel])
        detectedRow.axis = .horizontal
        detectedRow.spacing = 8
        detectedRow.alignment = .center

        let stack = makeContentStack([iconWrap, title, spacer(4), steps, detectedRow], tag: 201)
        let openBtn = makeSecondaryButton("Open Settings", action: #selector(openSettings))
        let continueBtn = makePrimaryButton("Continue", action: #selector(nextPage))

        container.addSubview(stack)
        container.addSubview(openBtn)
        container.addSubview(continueBtn)
        pinContentStack(stack, in: container)
        pinBottomButton(continueBtn, in: container)
        pinAboveButton(openBtn, above: continueBtn, in: container)

        checkKeyboardEnabled()
    }

    // ── Page 2: Full Access ─────────────────────────────────

    private func buildFullAccess() {
        let container = makePageContainer(index: 2)

        let icon = makeSFIcon("lock.shield.fill", size: 44, color: accentColor)
        let iconWrap = wrapIcon(icon)
        let title = makeTitle("Allow Full Access")
        let body = makeBody("Full Access lets the keyboard upload your encrypted seal to keywitness.io so you can share the proof link.")

        // Privacy assurance card
        let privacyCard = UIView()
        privacyCard.backgroundColor = greenGlow.withAlphaComponent(0.06)
        privacyCard.layer.cornerRadius = 12
        privacyCard.layer.borderWidth = 0.5
        privacyCard.layer.borderColor = greenGlow.withAlphaComponent(0.15).cgColor
        privacyCard.translatesAutoresizingMaskIntoConstraints = false

        let lockIcon = UIImageView(image: UIImage(systemName: "lock.fill"))
        lockIcon.tintColor = greenGlow
        lockIcon.translatesAutoresizingMaskIntoConstraints = false
        lockIcon.widthAnchor.constraint(equalToConstant: 16).isActive = true
        lockIcon.heightAnchor.constraint(equalToConstant: 16).isActive = true

        let privacyLabel = UILabel()
        privacyLabel.text = "Your text is encrypted on-device before upload. The server cannot read what you type."
        privacyLabel.font = .systemFont(ofSize: 14, weight: .medium)
        privacyLabel.textColor = greenGlow.withAlphaComponent(0.85)
        privacyLabel.numberOfLines = 0

        let privacyRow = UIStackView(arrangedSubviews: [lockIcon, privacyLabel])
        privacyRow.axis = .horizontal
        privacyRow.spacing = 10
        privacyRow.alignment = .top
        privacyRow.translatesAutoresizingMaskIntoConstraints = false
        privacyCard.addSubview(privacyRow)
        NSLayoutConstraint.activate([
            privacyRow.topAnchor.constraint(equalTo: privacyCard.topAnchor, constant: 14),
            privacyRow.leadingAnchor.constraint(equalTo: privacyCard.leadingAnchor, constant: 14),
            privacyRow.trailingAnchor.constraint(equalTo: privacyCard.trailingAnchor, constant: -14),
            privacyRow.bottomAnchor.constraint(equalTo: privacyCard.bottomAnchor, constant: -14),
        ])

        let stack = makeContentStack([iconWrap, title, body, spacer(4), privacyCard], tag: 202)
        let openBtn = makeSecondaryButton("Open Settings", action: #selector(openSettings))
        let continueBtn = makePrimaryButton("Continue", action: #selector(nextPage))

        container.addSubview(stack)
        container.addSubview(openBtn)
        container.addSubview(continueBtn)
        pinContentStack(stack, in: container)
        pinBottomButton(continueBtn, in: container)
        pinAboveButton(openBtn, above: continueBtn, in: container)
    }

    // ── Page 3: Face ID ─────────────────────────────────────

    private func buildFaceID() {
        let container = makePageContainer(index: 3)

        let icon = makeSFIcon("faceid", size: 44, color: accentColor)
        let iconWrap = wrapIcon(icon)
        let title = makeTitle("Confirm It's You")
        let body = makeBody("After sealing a message, Face ID proves the phone's owner saw it and approved it. This is optional but adds another layer of trust.")

        // Status
        let statusIcon = UIImageView(image: UIImage(systemName: "circle.dashed"))
        statusIcon.tintColor = dimText
        statusIcon.contentMode = .scaleAspectFit
        statusIcon.translatesAutoresizingMaskIntoConstraints = false
        statusIcon.widthAnchor.constraint(equalToConstant: 22).isActive = true
        statusIcon.heightAnchor.constraint(equalToConstant: 22).isActive = true
        self.faceIDStatusIcon = statusIcon

        let statusLabel = UILabel()
        statusLabel.text = ""
        statusLabel.font = .systemFont(ofSize: 14, weight: .medium)
        statusLabel.textColor = dimText
        self.faceIDStatusLabel = statusLabel

        let statusRow = UIStackView(arrangedSubviews: [statusIcon, statusLabel])
        statusRow.axis = .horizontal
        statusRow.spacing = 8
        statusRow.alignment = .center

        let stack = makeContentStack([iconWrap, title, body, statusRow], tag: 203)
        let enableBtn = makePrimaryButton("Enable Face ID", action: #selector(enableFaceID))
        let skipBtn = makeTextButton("Skip — I'll do this later", action: #selector(nextPage))
        skipBtn.tag = 300 // for animation

        container.addSubview(stack)
        container.addSubview(enableBtn)
        container.addSubview(skipBtn)
        pinContentStack(stack, in: container)
        pinBottomButton(skipBtn, in: container, bottomConstant: -16)
        pinAboveButton(enableBtn, above: skipBtn, in: container, spacing: 10)
    }

    // ── Page 4: Done ────────────────────────────────────────

    private func buildDone() {
        let container = makePageContainer(index: 4)

        // Big green checkmark with glow
        let glowBg = UIView()
        glowBg.translatesAutoresizingMaskIntoConstraints = false
        glowBg.backgroundColor = greenGlow.withAlphaComponent(0.08)
        glowBg.layer.cornerRadius = 48
        let icon = makeSFIcon("checkmark.circle.fill", size: 56, color: greenGlow)
        icon.translatesAutoresizingMaskIntoConstraints = false

        let iconContainer = UIView()
        iconContainer.translatesAutoresizingMaskIntoConstraints = false
        iconContainer.addSubview(glowBg)
        iconContainer.addSubview(icon)
        NSLayoutConstraint.activate([
            glowBg.widthAnchor.constraint(equalToConstant: 96),
            glowBg.heightAnchor.constraint(equalToConstant: 96),
            glowBg.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            glowBg.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            icon.centerXAnchor.constraint(equalTo: iconContainer.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: iconContainer.centerYAnchor),
            iconContainer.heightAnchor.constraint(equalToConstant: 96),
        ])

        let title = makeTitle("You're all set")
        let body = makeBody("Switch to the KeyWitness keyboard in any app. Type your message, then tap Seal.")

        // Mini trust chain
        let chain = makeTrustChain()

        let stack = makeContentStack([iconContainer, title, body, spacer(8), chain], tag: 204)
        let button = makePrimaryButton("Start Using KeyWitness", action: #selector(finishOnboarding))

        container.addSubview(stack)
        container.addSubview(button)
        pinContentStack(stack, in: container)
        pinBottomButton(button, in: container)
    }

    private func makeTrustChain() -> UIView {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 12
        card.layer.borderWidth = 0.5
        card.layer.borderColor = UIColor(white: 0.18, alpha: 1).cgColor
        card.translatesAutoresizingMaskIntoConstraints = false

        let items: [(String, String)] = [
            ("keyboard.fill", "Keystroke biometrics captured"),
            ("cpu", "Signed in Secure Enclave"),
            ("checkmark.shield.fill", "Device verified by Apple"),
            ("faceid", "Owner confirmed with Face ID"),
        ]

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false

        for (icon, text) in items {
            let dot = UIView()
            dot.translatesAutoresizingMaskIntoConstraints = false
            dot.backgroundColor = greenGlow
            dot.layer.cornerRadius = 3
            dot.widthAnchor.constraint(equalToConstant: 6).isActive = true
            dot.heightAnchor.constraint(equalToConstant: 6).isActive = true
            dot.layer.shadowColor = greenGlow.cgColor
            dot.layer.shadowRadius = 3
            dot.layer.shadowOpacity = 0.5
            dot.layer.shadowOffset = .zero

            let iv = UIImageView(image: UIImage(systemName: icon))
            iv.tintColor = dimText
            iv.contentMode = .scaleAspectFit
            iv.translatesAutoresizingMaskIntoConstraints = false
            iv.widthAnchor.constraint(equalToConstant: 14).isActive = true
            iv.heightAnchor.constraint(equalToConstant: 14).isActive = true

            let label = UILabel()
            label.text = text
            label.font = .systemFont(ofSize: 13, weight: .medium)
            label.textColor = bodyText

            let row = UIStackView(arrangedSubviews: [dot, iv, label])
            row.axis = .horizontal
            row.spacing = 8
            row.alignment = .center
            stack.addArrangedSubview(row)
        }

        card.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 14),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -14),
        ])

        return card
    }

    // MARK: - Actions

    @objc private func nextPage() {
        let current = pageControl.currentPage
        guard current < totalPages - 1 else { return }
        let next = current + 1
        let x = view.bounds.width * CGFloat(next)
        UIView.animate(withDuration: 0.35, delay: 0, usingSpringWithDamping: 0.92, initialSpringVelocity: 0, options: []) {
            self.scrollView.contentOffset = CGPoint(x: x, y: 0)
        }
        pageControl.currentPage = next
        animatePageIn(next)
    }

    @objc private func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(url)
    }

    @objc private func enableFaceID() {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            showAlert(title: "Biometrics Unavailable",
                      message: error?.localizedDescription ?? "This device does not support biometric authentication.")
            return
        }
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: "KeyWitness uses Face ID to confirm your identity when sealing messages.") { [weak self] success, _ in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if success {
                    self.faceIDEnabled = true
                    self.faceIDStatusIcon?.image = UIImage(systemName: "checkmark.circle.fill")
                    self.faceIDStatusIcon?.tintColor = self.greenGlow
                    self.faceIDStatusLabel?.text = "Face ID enabled"
                    self.faceIDStatusLabel?.textColor = self.greenGlow
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        self.nextPage()
                    }
                } else {
                    self.faceIDStatusIcon?.image = UIImage(systemName: "xmark.circle")
                    self.faceIDStatusIcon?.tintColor = self.dimText
                    self.faceIDStatusLabel?.text = "Not enabled"
                    self.faceIDStatusLabel?.textColor = self.dimText
                }
            }
        }
    }

    @objc private func finishOnboarding() {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        defaults?.set(true, forKey: "hasCompletedOnboarding")
        onComplete?()
    }

    // MARK: - Keyboard detection

    private func startKeyboardCheck() {
        keyboardCheckTimer?.invalidate()
        keyboardCheckTimer = Timer.scheduledTimer(withTimeInterval: 1.5, repeats: true) { [weak self] _ in
            self?.checkKeyboardEnabled()
        }
    }

    private func checkKeyboardEnabled() {
        let modes = UITextInputMode.activeInputModes
        let found = modes.contains { mode in
            guard let id = mode.value(forKey: "identifier") as? String else { return false }
            return id.contains("io.keywitness")
        }
        if found {
            keyboardDetectedIcon?.image = UIImage(systemName: "checkmark.circle.fill")
            keyboardDetectedIcon?.tintColor = greenGlow
            keyboardDetectedLabel?.text = "Keyboard enabled"
            keyboardDetectedLabel?.textColor = greenGlow
            keyboardCheckTimer?.invalidate()
            keyboardCheckTimer = nil
        }
    }

    // MARK: - UI Factories

    private func makePageContainer(index: Int) -> UIView {
        let container = UIView()
        container.tag = 100 + index
        container.backgroundColor = .clear
        scrollView.addSubview(container)
        return container
    }

    private func makeSFIcon(_ name: String, size: CGFloat, color: UIColor) -> UIImageView {
        let config = UIImage.SymbolConfiguration(pointSize: size, weight: .regular)
        let iv = UIImageView(image: UIImage(systemName: name, withConfiguration: config))
        iv.tintColor = color
        iv.contentMode = .scaleAspectFit
        return iv
    }

    private func wrapIcon(_ icon: UIImageView) -> UIView {
        let bg = UIView()
        bg.translatesAutoresizingMaskIntoConstraints = false
        bg.backgroundColor = accentColor.withAlphaComponent(0.08)
        bg.layer.cornerRadius = 36

        icon.translatesAutoresizingMaskIntoConstraints = false
        bg.addSubview(icon)

        let wrapper = UIView()
        wrapper.translatesAutoresizingMaskIntoConstraints = false
        wrapper.addSubview(bg)
        NSLayoutConstraint.activate([
            bg.widthAnchor.constraint(equalToConstant: 72),
            bg.heightAnchor.constraint(equalToConstant: 72),
            bg.centerXAnchor.constraint(equalTo: wrapper.centerXAnchor),
            bg.centerYAnchor.constraint(equalTo: wrapper.centerYAnchor),
            icon.centerXAnchor.constraint(equalTo: bg.centerXAnchor),
            icon.centerYAnchor.constraint(equalTo: bg.centerYAnchor),
            wrapper.heightAnchor.constraint(equalToConstant: 72),
        ])
        return wrapper
    }

    private func makeTitle(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 30, weight: .bold)
        l.textColor = .white
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }

    private func makeTagline(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 16, weight: .medium)
        l.textColor = dimText
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }

    private func makeBody(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 16, weight: .regular)
        l.textColor = bodyText
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }

    private func spacer(_ height: CGFloat) -> UIView {
        let v = UIView()
        v.translatesAutoresizingMaskIntoConstraints = false
        v.heightAnchor.constraint(equalToConstant: height).isActive = true
        return v
    }

    private func makeStepsCard(_ steps: [(String, String)]) -> UIView {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 14
        card.layer.borderWidth = 0.5
        card.layer.borderColor = UIColor(white: 0.18, alpha: 1).cgColor
        card.translatesAutoresizingMaskIntoConstraints = false

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 16),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16)
        ])

        for (num, text) in steps {
            let numLabel = UILabel()
            numLabel.text = num
            numLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .bold)
            numLabel.textColor = .white
            numLabel.textAlignment = .center
            numLabel.backgroundColor = accentColor
            numLabel.layer.cornerRadius = 12
            numLabel.clipsToBounds = true
            numLabel.translatesAutoresizingMaskIntoConstraints = false
            numLabel.widthAnchor.constraint(equalToConstant: 24).isActive = true
            numLabel.heightAnchor.constraint(equalToConstant: 24).isActive = true

            let textLabel = UILabel()
            textLabel.text = text
            textLabel.font = .systemFont(ofSize: 15, weight: .regular)
            textLabel.textColor = bodyText
            textLabel.numberOfLines = 0

            let row = UIStackView(arrangedSubviews: [numLabel, textLabel])
            row.axis = .horizontal
            row.spacing = 12
            row.alignment = .center
            stack.addArrangedSubview(row)
        }

        return card
    }

    private func makePrimaryButton(_ title: String, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 17, weight: .semibold)
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = accentColor
        b.layer.cornerRadius = 14
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 52).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeSecondaryButton(_ title: String, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 16, weight: .medium)
        b.setTitleColor(accentColor, for: .normal)
        b.backgroundColor = accentColor.withAlphaComponent(0.08)
        b.layer.cornerRadius = 14
        b.layer.borderWidth = 0.5
        b.layer.borderColor = accentColor.withAlphaComponent(0.2).cgColor
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 52).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeTextButton(_ title: String, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 14, weight: .regular)
        b.setTitleColor(dimText, for: .normal)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 36).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeContentStack(_ views: [UIView], tag: Int) -> UIStackView {
        let stack = UIStackView(arrangedSubviews: views)
        stack.axis = .vertical
        stack.spacing = 14
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.tag = tag
        return stack
    }

    // MARK: - Layout pinning

    private func pinContentStack(_ stack: UIStackView, in container: UIView) {
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 100),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32)
        ])
    }

    private func pinBottomButton(_ button: UIView, in container: UIView, bottomConstant: CGFloat = -64) {
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),
            button.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: bottomConstant)
        ])
    }

    private func pinAboveButton(_ button: UIView, above: UIView, in container: UIView, spacing: CGFloat = 10) {
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 32),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -32),
            button.bottomAnchor.constraint(equalTo: above.topAnchor, constant: -spacing)
        ])
    }

    private func showAlert(title: String, message: String) {
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}

// MARK: - UIScrollViewDelegate

extension OnboardingViewController: UIScrollViewDelegate {
    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        let page = Int(round(scrollView.contentOffset.x / view.bounds.width))
        let clamped = max(0, min(page, totalPages - 1))
        if pageControl.currentPage != clamped {
            pageControl.currentPage = clamped
            animatePageIn(clamped)
        }
    }
}

// MARK: - UIStackView helper

private extension UIStackView {
    var arrangedSubviews_: [UIView] { arrangedSubviews }
}
