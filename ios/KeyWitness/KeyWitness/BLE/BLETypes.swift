import Foundation
import CoreBluetooth

/// A keystroke event received over BLE from a web browser.
struct BLEKeystrokeEvent {
    let key: String
    let downAtMs: UInt32
    let upAtMs: UInt32
}

/// An active BLE attestation session with a connected web browser.
class BLESession {
    let sessionId: Data        // 16 bytes
    let nonce: Data            // from web
    let central: CBCentral
    var keystrokeEvents: [BLEKeystrokeEvent] = []
    var cleartext: String?
    let startedAt = Date()

    init(sessionId: Data, nonce: Data, central: CBCentral) {
        self.sessionId = sessionId
        self.nonce = nonce
        self.central = central
    }

    /// Convert BLE keystroke events to KeystrokeEvent structs for VCBuilder.
    /// Touch coordinates and force are unavailable from web input (set to 0).
    func toKeystrokeEvents() -> [KeystrokeEvent] {
        return keystrokeEvents.map { event in
            KeystrokeEvent(
                key: event.key,
                touchDownTime: TimeInterval(event.downAtMs) / 1000.0,
                touchUpTime: TimeInterval(event.upAtMs) / 1000.0,
                x: 0,
                y: 0,
                force: 0,
                majorRadius: 0
            )
        }
    }
}

/// Result of a BLE attestation flow.
struct BLEAttestationResult {
    let status: BLEConstants.AttestStatus
    let attestationBlock: String?
    let encryptionKey: String?
    let error: String?
}

/// Chunk reassembly buffer for multi-part BLE messages.
class ChunkBuffer {
    var totalChunks: UInt16 = 0
    var chunks: [UInt16: Data] = [:]

    var isComplete: Bool {
        totalChunks > 0 && chunks.count == Int(totalChunks)
    }

    func add(index: UInt16, total: UInt16, payload: Data) {
        totalChunks = total
        chunks[index] = payload
    }

    func reassemble() -> Data? {
        guard isComplete else { return nil }
        var result = Data()
        for i in 0..<totalChunks {
            guard let chunk = chunks[i] else { return nil }
            result.append(chunk)
        }
        return result
    }

    func reset() {
        totalChunks = 0
        chunks.removeAll()
    }
}
