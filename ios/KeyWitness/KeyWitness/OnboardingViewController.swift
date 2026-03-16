import UIKit
import LocalAuthentication

/// App Store-ready onboarding flow. 5 pages presented in a horizontal
/// paging scroll view with a page control. Completion triggers transition
/// to the main app.
class OnboardingViewController: UIViewController {

    // MARK: - Public

    /// Called when the user finishes (or skips through) onboarding.
    var onComplete: (() -> Void)?

    // MARK: - Constants

    private let totalPages = 5
    private let bgColor = UIColor(red: 0.06, green: 0.06, blue: 0.08, alpha: 1.0)
    private let cardColor = UIColor(red: 0.12, green: 0.12, blue: 0.14, alpha: 1.0)
    private let accentColor = UIColor(red: 0.20, green: 0.55, blue: 1.0, alpha: 1.0)
    private let successGreen = UIColor(red: 0.20, green: 0.78, blue: 0.35, alpha: 1.0)

    // MARK: - UI

    private let scrollView = UIScrollView()
    private let pageControl = UIPageControl()

    // Page 2 state
    private var keyboardDetectedIcon: UIImageView?
    private var keyboardDetectedLabel: UILabel?
    private var keyboardCheckTimer: Timer?

    // Page 4 state
    private var faceIDStatusIcon: UIImageView?
    private var faceIDStatusLabel: UILabel?
    private var faceIDEnabled = false

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = bgColor
        setupScrollView()
        setupPageControl()
        buildPages()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        startKeyboardCheck()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        keyboardCheckTimer?.invalidate()
        keyboardCheckTimer = nil
    }

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: - Layout scaffolding

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
        pageControl.currentPageIndicatorTintColor = accentColor
        pageControl.pageIndicatorTintColor = UIColor.white.withAlphaComponent(0.25)
        pageControl.translatesAutoresizingMaskIntoConstraints = false
        pageControl.isUserInteractionEnabled = false
        view.addSubview(pageControl)

        NSLayoutConstraint.activate([
            pageControl.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            pageControl.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -16)
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        let w = view.bounds.width
        let h = view.bounds.height
        scrollView.contentSize = CGSize(width: w * CGFloat(totalPages), height: h)

        for (i, sub) in scrollView.subviews.enumerated() where sub.tag >= 100 {
            let page = sub.tag - 100
            sub.frame = CGRect(x: w * CGFloat(page), y: 0, width: w, height: h)
        }
    }

    // MARK: - Page construction

    private func buildPages() {
        buildPage0_Welcome()
        buildPage1_AddKeyboard()
        buildPage2_FullAccess()
        buildPage3_FaceID()
        buildPage4_Done()
    }

    // MARK: Page 0 — Welcome

    private func buildPage0_Welcome() {
        let container = makePageContainer(index: 0)

        let icon = makeSFIcon("checkmark.seal.fill", size: 72, color: accentColor)
        let title = makeTitle("KeyWitness")
        let subtitle = makeSubtitle("Proof you're human. Not AI.")
        let body = makeBody("Every message you seal carries cryptographic proof it was typed by a real person on a real device. Verifiable by anyone.")
        let button = makePrimaryButton("Get Started", action: #selector(nextPage))

        let stack = makeContentStack([icon, title, subtitle, body])
        container.addSubview(stack)
        container.addSubview(button)

        pinContentStack(stack, in: container)
        pinBottomButton(button, in: container)
    }

    // MARK: Page 1 — Add the Keyboard

    private func buildPage1_AddKeyboard() {
        let container = makePageContainer(index: 1)

        let icon = makeSFIcon("keyboard.fill", size: 60, color: accentColor)
        let title = makeTitle("Add the Keyboard")

        let steps = makeNumberedSteps([
            "Open Settings \u{2192} General \u{2192} Keyboard \u{2192} Keyboards",
            "Tap \"Add New Keyboard...\"",
            "Select \"KeyWitness\""
        ])

        // Keyboard detection indicator
        let detectedIcon = UIImageView()
        detectedIcon.tintColor = UIColor.white.withAlphaComponent(0.4)
        detectedIcon.contentMode = .scaleAspectFit
        detectedIcon.image = UIImage(systemName: "circle.dashed")
        detectedIcon.translatesAutoresizingMaskIntoConstraints = false
        detectedIcon.widthAnchor.constraint(equalToConstant: 28).isActive = true
        detectedIcon.heightAnchor.constraint(equalToConstant: 28).isActive = true
        self.keyboardDetectedIcon = detectedIcon

        let detectedLabel = UILabel()
        detectedLabel.text = "Keyboard not yet detected"
        detectedLabel.font = .systemFont(ofSize: 15, weight: .medium)
        detectedLabel.textColor = UIColor.white.withAlphaComponent(0.4)
        self.keyboardDetectedLabel = detectedLabel

        let detectedRow = UIStackView(arrangedSubviews: [detectedIcon, detectedLabel])
        detectedRow.axis = .horizontal
        detectedRow.spacing = 8
        detectedRow.alignment = .center

        let openSettingsBtn = makeSecondaryButton("Open Settings", action: #selector(openSettings))
        let continueBtn = makePrimaryButton("Continue", action: #selector(nextPage))

        let stack = makeContentStack([icon, title, steps, detectedRow])
        container.addSubview(stack)
        container.addSubview(openSettingsBtn)
        container.addSubview(continueBtn)

        pinContentStack(stack, in: container)
        pinBottomButton(continueBtn, in: container)
        pinAboveButton(openSettingsBtn, above: continueBtn, in: container)

        // Check immediately
        checkKeyboardEnabled()
    }

    // MARK: Page 2 — Full Access

    private func buildPage2_FullAccess() {
        let container = makePageContainer(index: 2)

        let icon = makeSFIcon("lock.shield.fill", size: 60, color: accentColor)
        let title = makeTitle("Allow Full Access")
        let body = makeBody("Full Access lets the keyboard save your sealed message to keywitness.io so you can share the proof link.")

        let privacyIcon = makeSFIcon("lock.fill", size: 20, color: successGreen)
        let privacyLabel = UILabel()
        privacyLabel.text = "Your text is encrypted on your device before upload. We never see what you type."
        privacyLabel.font = .systemFont(ofSize: 15, weight: .regular)
        privacyLabel.textColor = UIColor.white.withAlphaComponent(0.7)
        privacyLabel.numberOfLines = 0

        let privacyRow = UIStackView(arrangedSubviews: [privacyIcon, privacyLabel])
        privacyRow.axis = .horizontal
        privacyRow.spacing = 10
        privacyRow.alignment = .top

        let openKBSettingsBtn = makeSecondaryButton("Open Keyboard Settings", action: #selector(openSettings))
        let continueBtn = makePrimaryButton("Continue", action: #selector(nextPage))

        let stack = makeContentStack([icon, title, body, privacyRow])
        container.addSubview(stack)
        container.addSubview(openKBSettingsBtn)
        container.addSubview(continueBtn)

        pinContentStack(stack, in: container)
        pinBottomButton(continueBtn, in: container)
        pinAboveButton(openKBSettingsBtn, above: continueBtn, in: container)
    }

    // MARK: Page 3 — Face ID

    private func buildPage3_FaceID() {
        let container = makePageContainer(index: 3)

        let icon = makeSFIcon("faceid", size: 60, color: accentColor)
        let title = makeTitle("Confirm It's You")
        let body = makeBody("After sealing a message, Face ID proves the phone's owner approved it. This adds another layer of trust to your attestation.")

        // Status indicator
        let statusIcon = UIImageView()
        statusIcon.tintColor = UIColor.white.withAlphaComponent(0.4)
        statusIcon.contentMode = .scaleAspectFit
        statusIcon.image = UIImage(systemName: "circle.dashed")
        statusIcon.translatesAutoresizingMaskIntoConstraints = false
        statusIcon.widthAnchor.constraint(equalToConstant: 28).isActive = true
        statusIcon.heightAnchor.constraint(equalToConstant: 28).isActive = true
        self.faceIDStatusIcon = statusIcon

        let statusLabel = UILabel()
        statusLabel.text = ""
        statusLabel.font = .systemFont(ofSize: 15, weight: .medium)
        statusLabel.textColor = UIColor.white.withAlphaComponent(0.4)
        self.faceIDStatusLabel = statusLabel

        let statusRow = UIStackView(arrangedSubviews: [statusIcon, statusLabel])
        statusRow.axis = .horizontal
        statusRow.spacing = 8
        statusRow.alignment = .center

        let enableBtn = makePrimaryButton("Enable Face ID", action: #selector(enableFaceID))
        let skipBtn = makeTextButton("Skip", action: #selector(nextPage))

        let stack = makeContentStack([icon, title, body, statusRow])
        container.addSubview(stack)
        container.addSubview(enableBtn)
        container.addSubview(skipBtn)

        pinContentStack(stack, in: container)
        pinBottomButton(skipBtn, in: container, bottomConstant: -16)
        pinAboveButton(enableBtn, above: skipBtn, in: container, spacing: 12)
    }

    // MARK: Page 4 — Done

    private func buildPage4_Done() {
        let container = makePageContainer(index: 4)

        let icon = makeSFIcon("checkmark.circle.fill", size: 72, color: successGreen)
        let title = makeTitle("You're all set")
        let body = makeBody("Switch to the KeyWitness keyboard in any app.\nType your message, then tap Seal.")
        let button = makePrimaryButton("Start", action: #selector(finishOnboarding))

        let stack = makeContentStack([icon, title, body])
        container.addSubview(stack)
        container.addSubview(button)

        pinContentStack(stack, in: container)
        pinBottomButton(button, in: container)
    }

    // MARK: - Actions

    @objc private func nextPage() {
        let current = pageControl.currentPage
        guard current < totalPages - 1 else { return }
        let next = current + 1
        let x = view.bounds.width * CGFloat(next)
        UIView.animate(withDuration: 0.3, delay: 0, options: .curveEaseInOut) {
            self.scrollView.contentOffset = CGPoint(x: x, y: 0)
        }
        pageControl.currentPage = next
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
                    self.faceIDStatusIcon?.tintColor = self.successGreen
                    self.faceIDStatusLabel?.text = "Face ID enabled"
                    self.faceIDStatusLabel?.textColor = self.successGreen

                    // Auto-advance after a short delay
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        self.nextPage()
                    }
                } else {
                    self.faceIDStatusIcon?.image = UIImage(systemName: "xmark.circle")
                    self.faceIDStatusIcon?.tintColor = UIColor.white.withAlphaComponent(0.4)
                    self.faceIDStatusLabel?.text = "Not enabled"
                    self.faceIDStatusLabel?.textColor = UIColor.white.withAlphaComponent(0.4)
                }
            }
        }
    }

    @objc private func finishOnboarding() {
        // Persist completion
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
            keyboardDetectedIcon?.tintColor = successGreen
            keyboardDetectedLabel?.text = "Keyboard enabled"
            keyboardDetectedLabel?.textColor = successGreen
            keyboardCheckTimer?.invalidate()
            keyboardCheckTimer = nil
        }
    }

    // MARK: - UI Helpers

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
        iv.translatesAutoresizingMaskIntoConstraints = false
        iv.heightAnchor.constraint(equalToConstant: size + 16).isActive = true
        return iv
    }

    private func makeTitle(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 34, weight: .bold)
        l.textColor = .white
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }

    private func makeSubtitle(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 20, weight: .semibold)
        l.textColor = UIColor.white.withAlphaComponent(0.85)
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }

    private func makeBody(_ text: String) -> UILabel {
        let l = UILabel()
        l.text = text
        l.font = .systemFont(ofSize: 17, weight: .regular)
        l.textColor = UIColor.white.withAlphaComponent(0.7)
        l.textAlignment = .center
        l.numberOfLines = 0
        return l
    }

    private func makeNumberedSteps(_ steps: [String]) -> UIView {
        let card = UIView()
        card.backgroundColor = cardColor
        card.layer.cornerRadius = 14
        card.translatesAutoresizingMaskIntoConstraints = false

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 16
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 18),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 18),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -18),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -18)
        ])

        for (i, step) in steps.enumerated() {
            let numLabel = UILabel()
            numLabel.text = "\(i + 1)"
            numLabel.font = .systemFont(ofSize: 15, weight: .bold)
            numLabel.textColor = .white
            numLabel.textAlignment = .center
            numLabel.backgroundColor = accentColor
            numLabel.layer.cornerRadius = 13
            numLabel.clipsToBounds = true
            numLabel.translatesAutoresizingMaskIntoConstraints = false
            numLabel.widthAnchor.constraint(equalToConstant: 26).isActive = true
            numLabel.heightAnchor.constraint(equalToConstant: 26).isActive = true

            let textLabel = UILabel()
            textLabel.text = step
            textLabel.font = .systemFont(ofSize: 16, weight: .regular)
            textLabel.textColor = UIColor.white.withAlphaComponent(0.85)
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
        b.titleLabel?.font = .systemFont(ofSize: 18, weight: .semibold)
        b.setTitleColor(.white, for: .normal)
        b.backgroundColor = accentColor
        b.layer.cornerRadius = 14
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 50).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeSecondaryButton(_ title: String, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        b.setTitleColor(accentColor, for: .normal)
        b.backgroundColor = accentColor.withAlphaComponent(0.12)
        b.layer.cornerRadius = 14
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 50).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeTextButton(_ title: String, action: Selector) -> UIButton {
        let b = UIButton(type: .system)
        b.setTitle(title, for: .normal)
        b.titleLabel?.font = .systemFont(ofSize: 16, weight: .regular)
        b.setTitleColor(UIColor.white.withAlphaComponent(0.5), for: .normal)
        b.translatesAutoresizingMaskIntoConstraints = false
        b.heightAnchor.constraint(equalToConstant: 36).isActive = true
        b.addTarget(self, action: action, for: .touchUpInside)
        return b
    }

    private func makeContentStack(_ views: [UIView]) -> UIStackView {
        let stack = UIStackView(arrangedSubviews: views)
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        return stack
    }

    // MARK: - Layout pinning helpers

    private func pinContentStack(_ stack: UIStackView, in container: UIView) {
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: container.topAnchor, constant: 100),
            stack.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -28)
        ])
    }

    private func pinBottomButton(_ button: UIButton, in container: UIView, bottomConstant: CGFloat = -60) {
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 28),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -28),
            button.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: bottomConstant)
        ])
    }

    private func pinAboveButton(_ button: UIButton, above: UIButton, in container: UIView, spacing: CGFloat = 10) {
        NSLayoutConstraint.activate([
            button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 28),
            button.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -28),
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
        pageControl.currentPage = max(0, min(page, totalPages - 1))
    }
}
