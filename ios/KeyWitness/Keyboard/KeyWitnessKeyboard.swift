import UIKit
import UserNotifications
import KeyboardKit
import SwiftUI

/// KeyWitnessKeyboard uses KeyboardKit for full keyboard layout (letters, numbers,
/// symbols, globe) and overlays a transparent touch tracker to capture biometric
/// keystroke data (coordinates, force, radius, timing) for cryptographic attestation.
///
/// NOTE: Networking requires `RequestsOpenAccess = true` in Info.plist AND the
/// user must grant "Allow Full Access" in Settings > General > Keyboard > KeyWitness.
class KeyWitnessKeyboard: KeyboardInputViewController {

    // MARK: - Configuration

    static var serverBaseURL = "https://www.keywitness.io"

    // MARK: - State

    var keystrokeEvents: [KeystrokeEvent] = []
    var touchTracker: BiometricTouchTracker?
    var pendingTouchDown: (time: TimeInterval, x: CGFloat, y: CGFloat, force: CGFloat, radius: CGFloat)?
    var isAttesting = false

    // MARK: - Lifecycle

    override func viewDidLoad() {
        super.viewDidLoad()
    }

    override func viewWillSetupKeyboardView() {
        // Set up action handler here — state/services are ready by viewWillAppear
        services.actionHandler = KeyWitnessActionHandler(
            controller: self,
            keyboard: self
        )

        // Don't call super — we provide our own view
        setupKeyboardView { [weak self] controller in
            KeyWitnessKeyboardView(
                state: controller.state,
                services: controller.services,
                onAttest: { self?.attestTapped() }
            )
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        installTouchTracker()
    }

    // MARK: - Touch Tracking Overlay

    private func installTouchTracker() {
        guard touchTracker == nil, let inputView = self.inputView else { return }

        let tracker = BiometricTouchTracker { [weak self] touchData in
            if touchData.phase == .began {
                self?.pendingTouchDown = (
                    time: touchData.timestamp,
                    x: touchData.x,
                    y: touchData.y,
                    force: touchData.force,
                    radius: touchData.radius
                )
            }
        }
        tracker.cancelsTouchesInView = false
        tracker.delaysTouchesBegan = false
        tracker.delaysTouchesEnded = false
        tracker.delegate = tracker
        inputView.addGestureRecognizer(tracker)
        self.touchTracker = tracker
    }

    /// Called by the action handler when a character key is pressed.
    func recordKeystroke(key: String) {
        let now = ProcessInfo.processInfo.systemUptime
        let down = pendingTouchDown
        pendingTouchDown = nil

        let keystroke = KeystrokeEvent(
            key: key,
            touchDownTime: down?.time ?? now,
            touchUpTime: now,
            x: down?.x ?? 0,
            y: down?.y ?? 0,
            force: down?.force ?? 0,
            majorRadius: down?.radius ?? 0
        )
        keystrokeEvents.append(keystroke)
    }

    // MARK: - Attestation

    func attestTapped() {
        guard !isAttesting else { return }

        let beforeCursor = textDocumentProxy.documentContextBeforeInput ?? ""
        let afterCursor = textDocumentProxy.documentContextAfterInput ?? ""
        let cleartext = beforeCursor + afterCursor

        guard !cleartext.isEmpty else { return }

        isAttesting = true

        let events = keystrokeEvents
        Task {
            do {
                let defaults = UserDefaults(suiteName: "group.io.keywitness")
                let sessionAssertion = defaults?.string(forKey: "appAttestSessionAssertion")
                let sessionKeyId = defaults?.string(forKey: "appAttestSessionKeyId")
                let sessionClientData = defaults?.string(forKey: "appAttestSessionClientData")

                let sessionValid = sessionAssertion != nil
                NSLog("[KeyWitness] Session token valid: %d", sessionValid ? 1 : 0)

                let (attestationBlock, encryptionKey) = try AttestationBuilder.createV3Attestation(
                    cleartext: cleartext,
                    keystrokeEvents: events,
                    faceIdVerified: false,
                    appAttestKeyId: sessionValid ? sessionKeyId : nil,
                    appAttestAssertion: sessionValid ? sessionAssertion : nil,
                    appAttestClientData: sessionValid ? sessionClientData : nil
                )
                NSLog("[KeyWitness] v3 attestation built successfully")

                self.uploadAttestation(attestationBlock, encryptionKey: encryptionKey,
                                       sessionKeyId: sessionValid ? sessionKeyId : nil,
                                       sessionAssertion: sessionValid ? sessionAssertion : nil,
                                       sessionClientData: sessionValid ? sessionClientData : nil) { [weak self] result in
                    DispatchQueue.main.async {
                        guard let self = self else { return }
                        self.isAttesting = false

                        switch result {
                        case .success(let (url, shortId)):
                            let before = self.textDocumentProxy.documentContextBeforeInput ?? ""
                            if !before.isEmpty && !before.hasSuffix(" ") && !before.hasSuffix("\n") {
                                self.textDocumentProxy.insertText(" ")
                            }
                            let shortURL = url
                                .replacingOccurrences(of: "https://www.", with: "https://")
                            self.textDocumentProxy.insertText(shortURL)

                            self.storePendingBiometric(shortId: shortId, cleartext: cleartext)
                            self.fireBiometricNotification(shortId: shortId, cleartext: cleartext)

                        case .failure:
                            self.textDocumentProxy.insertText("\n\n" + attestationBlock)
                        }
                        self.keystrokeEvents.removeAll()
                    }
                }
            } catch {
                await MainActor.run {
                    self.isAttesting = false
                    self.keystrokeEvents.removeAll()
                    self.textDocumentProxy.insertText("\n[Attestation error: \(error.localizedDescription)]")
                }
            }
        }
    }

    // MARK: - Biometric Notification

    private func storePendingBiometric(shortId: String, cleartext: String) {
        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        defaults?.set(shortId, forKey: "pendingBiometricShortId")
        defaults?.set(Date(), forKey: "pendingBiometricCreatedAt")
        defaults?.set(cleartext, forKey: "pendingBiometricCleartext")
    }

    private func fireBiometricNotification(shortId: String, cleartext: String) {
        let messagePreview: String
        if cleartext.count > 100 {
            messagePreview = String(cleartext.prefix(100)) + "..."
        } else {
            messagePreview = cleartext
        }

        let defaults = UserDefaults(suiteName: "group.io.keywitness")
        defaults?.set(Date().addingTimeInterval(30), forKey: "pendingBiometricExpiresAt")

        let content = UNMutableNotificationContent()
        content.title = "Confirm it's you"
        content.body = "You wrote: \"\(messagePreview)\"\n\nTap to verify with Face ID — 30 seconds."
        content.sound = .default
        content.userInfo = ["shortId": shortId, "cleartext": cleartext]
        if #available(iOSApplicationExtension 15.0, *) {
            content.interruptionLevel = .timeSensitive
        }

        let request = UNNotificationRequest(
            identifier: "keywitness-biometric-\(shortId)",
            content: content,
            trigger: nil
        )
        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
    }

    // MARK: - Upload Helper

    private func uploadAttestation(_ attestationBlock: String,
                                   encryptionKey: String,
                                   sessionKeyId: String? = nil,
                                   sessionAssertion: String? = nil,
                                   sessionClientData: String? = nil,
                                   completion: @escaping (Result<(String, String), Error>) -> Void) {
        let endpoint = Self.serverBaseURL + "/api/attestations"

        guard let url = URL(string: endpoint) else {
            completion(.failure(UploadError.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        var body: [String: String] = ["attestation": attestationBlock]
        if let keyId = sessionKeyId { body["appAttestKeyId"] = keyId }
        if let assertion = sessionAssertion { body["appAttestAssertion"] = assertion }
        if let clientData = sessionClientData { body["appAttestClientData"] = clientData }
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
                   let attestationURL = json["url"] as? String,
                   let shortId = json["id"] as? String {
                    completion(.success((attestationURL + "#" + encryptionKey, shortId)))
                } else {
                    completion(.failure(UploadError.unexpectedResponse))
                }
            } catch {
                completion(.failure(error))
            }
        }.resume()
    }
}

// MARK: - KeyboardKit Action Handler

/// Intercepts KeyboardKit key presses to record biometric keystroke data.
class KeyWitnessActionHandler: KeyboardAction.StandardActionHandler {

    private weak var keyboard: KeyWitnessKeyboard?

    init(controller: KeyboardInputViewController, keyboard: KeyWitnessKeyboard) {
        self.keyboard = keyboard
        super.init(
            controller: controller,
            keyboardContext: controller.state.keyboardContext,
            keyboardBehavior: controller.services.keyboardBehavior,
            autocompleteContext: controller.state.autocompleteContext,
            autocompleteService: controller.services.autocompleteService,
            emojiContext: controller.state.emojiContext,
            feedbackContext: controller.state.feedbackContext,
            feedbackService: controller.services.feedbackService,
            spaceDragGestureHandler: controller.services.spaceDragGestureHandler
        )
    }

    override func handle(
        _ gesture: Keyboard.Gesture,
        on action: KeyboardAction
    ) {
        // Record character keystrokes for biometrics on release
        if gesture == .release {
            switch action {
            case .character(let char):
                keyboard?.recordKeystroke(key: char)
            case .space:
                keyboard?.recordKeystroke(key: "space")
            default:
                break
            }
        }

        // Let KeyboardKit handle the actual key action
        super.handle(gesture, on: action)
    }
}

// MARK: - SwiftUI Keyboard View

/// The keyboard view using KeyboardKit with a custom Seal toolbar.
struct KeyWitnessKeyboardView: View {

    let state: Keyboard.State
    let services: Keyboard.Services
    let onAttest: () -> Void

    @EnvironmentObject var keyboardContext: KeyboardContext

    var body: some View {
        KeyboardView(
            state: state,
            services: services,
            buttonContent: { $0.view },
            buttonView: { $0.view },
            collapsedView: { $0.view },
            emojiKeyboard: { $0.view },
            toolbar: { _ in
                sealToolbar
            }
        )
    }

    private var sealToolbar: some View {
        HStack(spacing: 8) {
            Spacer()
            Button(action: onAttest) {
                HStack(spacing: 4) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 13))
                    Text("Seal")
                        .font(.system(size: 14, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 7)
                .background(Color(red: 0.20, green: 0.55, blue: 1.0))
                .cornerRadius(7)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
    }
}

// MARK: - Biometric Touch Tracker

struct BiometricTouchData {
    let timestamp: TimeInterval
    let x: CGFloat
    let y: CGFloat
    let force: CGFloat
    let radius: CGFloat
    let phase: UITouch.Phase
}

/// Passively captures touch biometric data without interfering with KeyboardKit gestures.
class BiometricTouchTracker: UIGestureRecognizer, UIGestureRecognizerDelegate {

    private let onTouch: (BiometricTouchData) -> Void

    init(onTouch: @escaping (BiometricTouchData) -> Void) {
        self.onTouch = onTouch
        super.init(target: nil, action: nil)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesBegan(touches, with: event)
        for touch in touches {
            let loc = touch.location(in: self.view)
            onTouch(BiometricTouchData(
                timestamp: ProcessInfo.processInfo.systemUptime,
                x: loc.x, y: loc.y,
                force: touch.force,
                radius: touch.majorRadius,
                phase: .began
            ))
        }
        state = .possible
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesEnded(touches, with: event)
        state = .possible
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        super.touchesCancelled(touches, with: event)
        state = .possible
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                           shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
        return true
    }
}

// MARK: - Upload Errors

private enum UploadError: Error, LocalizedError {
    case invalidURL
    case serverError
    case unexpectedResponse

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL"
        case .serverError: return "Server returned an error"
        case .unexpectedResponse: return "Unexpected server response"
        }
    }
}
