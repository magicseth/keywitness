import UIKit
import LocalAuthentication

/// Orchestrates the BLE attestation flow: user confirmation, Face ID, signing, and response.
final class BLEAttestationFlow {

    private weak var viewController: UIViewController?
    private let bleManager: BLEPeripheralManager

    init(viewController: UIViewController, bleManager: BLEPeripheralManager) {
        self.viewController = viewController
        self.bleManager = bleManager
    }

    /// Show the cleartext to the user, then trigger Face ID and sign if confirmed.
    func requestAttestation(session: BLESession, cleartext: String) {
        DispatchQueue.main.async { [weak self] in
            self?.showConfirmation(session: session, cleartext: cleartext)
        }
    }

    /// Reconstruct what the user actually typed by replaying BLE keystroke events.
    private func reconstructText(from events: [BLEKeystrokeEvent]) -> String {
        var chars: [String] = []
        for event in events {
            if event.key == "backspace" {
                if !chars.isEmpty { chars.removeLast() }
            } else if event.key == "space" {
                chars.append(" ")
            } else if event.key == "newline" {
                chars.append("\n")
            } else {
                chars.append(event.key)
            }
        }
        return chars.joined()
    }

    private func showConfirmation(session: BLESession, cleartext: String) {
        guard let vc = viewController else {
            sendError(session: session, error: "No view controller")
            return
        }

        // Reconstruct text from BLE keystrokes — this is what the user actually typed,
        // NOT what the browser claims. The user must confirm these match.
        let reconstructed = reconstructText(from: session.keystrokeEvents)

        let preview: String
        if reconstructed.count > 500 {
            preview = String(reconstructed.prefix(500)) + "..."
        } else {
            preview = reconstructed
        }

        // Check if the browser's cleartext matches the reconstructed keystrokes
        let matches = cleartext.trimmingCharacters(in: .whitespaces) == reconstructed.trimmingCharacters(in: .whitespaces)

        let title = matches ? "Confirm Web Attestation" : "⚠️ Text Mismatch"
        let mismatchWarning = matches ? "" : "\n\n⚠️ The browser sent different text than what your keystrokes produced. Only confirm if this looks correct."

        let alert = UIAlertController(
            title: title,
            message: "Your keystrokes produced:\n\n\"\(preview)\"\n\n\(session.keystrokeEvents.count) keystrokes recorded over BLE.\(mismatchWarning)",
            preferredStyle: .alert
        )

        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in
            self?.sendCancelled(session: session)
        })

        alert.addAction(UIAlertAction(title: "Confirm with Face ID", style: .default) { [weak self] _ in
            self?.performFaceID(session: session, cleartext: cleartext)
        })

        vc.present(alert, animated: true)
    }

    private func performFaceID(session: BLESession, cleartext: String) {
        let context = LAContext()
        context.localizedFallbackTitle = ""
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            sendError(session: session, error: "Biometrics unavailable: \(error?.localizedDescription ?? "unknown")")
            return
        }

        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics,
                               localizedReason: "Confirm you typed this text on the web") { [weak self] success, authError in
            DispatchQueue.main.async {
                if success {
                    self?.signAndSend(session: session, cleartext: cleartext, faceIdVerified: true)
                } else {
                    self?.sendCancelled(session: session)
                }
            }
        }
    }

    private func signAndSend(session: BLESession, cleartext: String, faceIdVerified: Bool) {
        Task {
            do {
                let keystrokeEvents = session.toKeystrokeEvents()

                // Generate App Attest assertion
                var appAttestKeyId: String? = nil
                var appAttestAssertion: String? = nil
                var appAttestClientData: String? = nil

                if AppAttestManager.shared.isSupported {
                    do {
                        let shortId = CryptoEngine.sha256Base64URL(Data(cleartext.utf8))
                        let clientDataString = "keywitness:ble-attest:\(shortId)"
                        let clientDataBytes = clientDataString.data(using: .utf8)!
                        let assertion = try await AppAttestManager.shared.generateAssertion(for: clientDataBytes)
                        appAttestKeyId = AppAttestManager.shared.keyId
                        appAttestAssertion = CryptoEngine.base64URLEncode(assertion)
                        appAttestClientData = clientDataString
                    } catch {
                        NSLog("[BLE] App Attest assertion failed: %@", error.localizedDescription)
                    }
                }

                // Encode the session nonce as base64url to bind this VC to the BLE session
                let challengeString = CryptoEngine.base64URLEncode(session.nonce)

                let (block, encryptionKey) = try VCBuilder.createVC(
                    cleartext: cleartext,
                    keystrokeEvents: keystrokeEvents,
                    faceIdVerified: faceIdVerified,
                    appAttestKeyId: appAttestKeyId,
                    appAttestAssertion: appAttestAssertion,
                    appAttestClientData: appAttestClientData,
                    appAttestObject: AppAttestManager.shared.attestationObject,
                    challenge: challengeString
                )

                let result = BLEAttestationResult(
                    status: .success,
                    attestationBlock: block,
                    encryptionKey: encryptionKey,
                    error: nil
                )

                await MainActor.run {
                    bleManager.sendAttestationResult(result)
                }
                NSLog("[BLE] Attestation signed and sent")

            } catch {
                await MainActor.run {
                    sendError(session: session, error: error.localizedDescription)
                }
            }
        }
    }

    private func sendCancelled(session: BLESession) {
        let result = BLEAttestationResult(
            status: .userCancelled,
            attestationBlock: nil,
            encryptionKey: nil,
            error: "User cancelled"
        )
        bleManager.sendAttestationResult(result)
    }

    private func sendError(session: BLESession, error: String) {
        let result = BLEAttestationResult(
            status: .error,
            attestationBlock: nil,
            encryptionKey: nil,
            error: error
        )
        bleManager.sendAttestationResult(result)
    }
}
