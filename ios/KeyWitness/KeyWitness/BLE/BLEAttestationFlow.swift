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

    private func showConfirmation(session: BLESession, cleartext: String) {
        guard let vc = viewController else {
            sendError(session: session, error: "No view controller")
            return
        }

        let preview: String
        if cleartext.count > 500 {
            preview = String(cleartext.prefix(500)) + "..."
        } else {
            preview = cleartext
        }

        let alert = UIAlertController(
            title: "Confirm Web Attestation",
            message: "A web browser wants to attest that you typed:\n\n\"\(preview)\"\n\n\(session.keystrokeEvents.count) keystrokes recorded over BLE.",
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

                let (block, encryptionKey) = try VCBuilder.createVC(
                    cleartext: cleartext,
                    keystrokeEvents: keystrokeEvents,
                    faceIdVerified: faceIdVerified,
                    appAttestKeyId: appAttestKeyId,
                    appAttestAssertion: appAttestAssertion,
                    appAttestClientData: appAttestClientData
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
