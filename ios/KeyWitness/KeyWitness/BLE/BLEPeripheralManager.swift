import Foundation
import CoreBluetooth

/// Delegate for BLE attestation events.
protocol BLEPeripheralDelegate: AnyObject {
    /// Called when a web browser connects and starts a session.
    func bleSessionStarted(_ session: BLESession)
    /// Called when a keystroke event is received.
    func bleKeystrokeReceived(_ session: BLESession, count: Int)
    /// Called when the web requests attestation — show confirmation UI + Face ID.
    func bleAttestationRequested(_ session: BLESession, cleartext: String, cleartextHash: Data)
    /// Called when the session ends (disconnect or completion).
    func bleSessionEnded()
}

/// CoreBluetooth peripheral that advertises the KeyWitness attestation service.
/// Web browsers connect via Web Bluetooth to send keystroke timing and request attestations.
final class BLEPeripheralManager: NSObject {

    weak var delegate: BLEPeripheralDelegate?

    private var peripheralManager: CBPeripheralManager!
    private var service: CBMutableService?
    private var activeSession: BLESession?
    private var attestRequestBuffer = ChunkBuffer()

    // Characteristics (stored for sending notifications)
    private var sessionCharacteristic: CBMutableCharacteristic?
    private var attestResultCharacteristic: CBMutableCharacteristic?

    private(set) var isAdvertising = false

    override init() {
        super.init()
        peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
    }

    // MARK: - Public API

    func startAdvertising() {
        guard peripheralManager.state == .poweredOn else {
            NSLog("[BLE] Cannot advertise: Bluetooth not powered on (state=%d)", peripheralManager.state.rawValue)
            return
        }
        guard !isAdvertising else { return }

        if service == nil {
            setupService()
        }

        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [BLEConstants.serviceUUID],
            CBAdvertisementDataLocalNameKey: BLEConstants.localName,
        ])
        isAdvertising = true
        NSLog("[BLE] Started advertising")
    }

    func stopAdvertising() {
        peripheralManager.stopAdvertising()
        isAdvertising = false
        activeSession = nil
        NSLog("[BLE] Stopped advertising")
    }

    /// Send the attestation result back to the web browser over BLE.
    func sendAttestationResult(_ result: BLEAttestationResult) {
        guard let session = activeSession,
              let characteristic = attestResultCharacteristic else {
            NSLog("[BLE] No active session to send result to")
            return
        }

        let payload: Data
        if let block = result.attestationBlock, let key = result.encryptionKey {
            // Combine block + newline + key
            let combined = "\(block)\n\(key)"
            payload = Data(combined.utf8)
        } else {
            payload = Data((result.error ?? "Unknown error").utf8)
        }

        // Chunk the payload
        let chunkSize = BLEConstants.defaultChunkSize
        let totalChunks = UInt16((payload.count + chunkSize - 1) / chunkSize)

        for i in 0..<totalChunks {
            let start = Int(i) * chunkSize
            let end = min(start + chunkSize, payload.count)
            let chunkPayload = payload[start..<end]

            // Header: [status:1] [totalChunks:2] [chunkIndex:2] [payload:N]
            var chunk = Data()
            chunk.append(result.status.rawValue)
            chunk.append(contentsOf: withUnsafeBytes(of: totalChunks.littleEndian) { Array($0) })
            chunk.append(contentsOf: withUnsafeBytes(of: i.littleEndian) { Array($0) })
            chunk.append(chunkPayload)

            peripheralManager.updateValue(chunk, for: characteristic, onSubscribedCentrals: [session.central])
        }

        NSLog("[BLE] Sent attestation result: status=%d, chunks=%d", result.status.rawValue, totalChunks)
    }

    // MARK: - Service Setup

    private func setupService() {
        // Session characteristic: read + write + notify
        sessionCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.sessionUUID,
            properties: [.read, .write, .notify],
            value: nil,
            permissions: [.readable, .writeable]
        )

        // Keystroke characteristic: write without response (for speed)
        let keystrokeCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.keystrokeUUID,
            properties: [.writeWithoutResponse],
            value: nil,
            permissions: [.writeable]
        )

        // Attest request characteristic: write
        let attestRequestCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.attestRequestUUID,
            properties: [.write],
            value: nil,
            permissions: [.writeable]
        )

        // Attest result characteristic: read + notify
        attestResultCharacteristic = CBMutableCharacteristic(
            type: BLEConstants.attestResultUUID,
            properties: [.read, .notify],
            value: nil,
            permissions: [.readable]
        )

        let svc = CBMutableService(type: BLEConstants.serviceUUID, primary: true)
        svc.characteristics = [
            sessionCharacteristic!,
            keystrokeCharacteristic,
            attestRequestCharacteristic,
            attestResultCharacteristic!,
        ]

        peripheralManager.add(svc)
        service = svc
        NSLog("[BLE] Service configured with 4 characteristics")
    }

    // MARK: - Message Parsing

    private func handleSessionInit(_ data: Data, from central: CBCentral) {
        // [0x10] [protocolVersion:1] [nonce:16]
        guard data.count >= 18,
              data[0] == BLEConstants.MessageType.sessionInit.rawValue else {
            NSLog("[BLE] Invalid session init (len=%d)", data.count)
            return
        }

        let version = data[1]
        let nonce = data[2..<18]

        NSLog("[BLE] Session init: version=%d, nonce=%d bytes", version, nonce.count)

        // Create session
        let sessionId = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
        let session = BLESession(sessionId: sessionId, nonce: Data(nonce), central: central)
        activeSession = session
        attestRequestBuffer.reset()

        // Send session ack
        sendSessionAck(session)
        delegate?.bleSessionStarted(session)
    }

    private func sendSessionAck(_ session: BLESession) {
        guard let characteristic = sessionCharacteristic else { return }

        do {
            let publicKeyData = try CryptoEngine.getOrCreateSigningKey().publicKey.rawRepresentation
            let issuerDID = DIDKey.ed25519ToDIDKey(publicKeyData)
            let didBytes = Data(issuerDID.utf8)

            // [0x11] [sessionId:16] [publicKey:32] [didKeyLen:1] [didKey:N]
            var ack = Data()
            ack.append(BLEConstants.MessageType.sessionAck.rawValue)
            ack.append(session.sessionId)
            ack.append(publicKeyData)
            ack.append(UInt8(didBytes.count))
            ack.append(didBytes)

            peripheralManager.updateValue(ack, for: characteristic, onSubscribedCentrals: [session.central])
            NSLog("[BLE] Sent session ack: did=%@", issuerDID)
        } catch {
            NSLog("[BLE] Failed to send session ack: %@", error.localizedDescription)
        }
    }

    private func handleKeystrokeEvent(_ data: Data) {
        guard let session = activeSession else { return }

        // [0x01] [keyLen:1] [key:N] [downAt:4] [upAt:4]
        guard data.count >= 10, data[0] == BLEConstants.MessageType.keystrokeEvent.rawValue else {
            return
        }

        let keyLen = Int(data[1])
        guard data.count >= 2 + keyLen + 8 else { return }

        let keyData = data[2..<(2 + keyLen)]
        let key = String(data: keyData, encoding: .utf8) ?? "?"

        let downOffset = 2 + keyLen
        let downAt = data[downOffset..<(downOffset + 4)].withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
        let upAt = data[(downOffset + 4)..<(downOffset + 8)].withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }

        let event = BLEKeystrokeEvent(key: key, downAtMs: downAt, upAtMs: upAt)
        session.keystrokeEvents.append(event)
        delegate?.bleKeystrokeReceived(session, count: session.keystrokeEvents.count)
    }

    private func handleAttestRequest(_ data: Data) {
        guard let session = activeSession else { return }

        // Check if this is a chunked message
        // [chunkIndex:2] [totalChunks:2] [payload:N]
        guard data.count >= 4 else { return }

        let chunkIndex = data[0..<2].withUnsafeBytes { $0.load(as: UInt16.self).littleEndian }
        let totalChunks = data[2..<4].withUnsafeBytes { $0.load(as: UInt16.self).littleEndian }
        let payload = data[4...]

        attestRequestBuffer.add(index: chunkIndex, total: totalChunks, payload: Data(payload))

        guard attestRequestBuffer.isComplete, let fullData = attestRequestBuffer.reassemble() else {
            NSLog("[BLE] Attest request chunk %d/%d received", chunkIndex + 1, totalChunks)
            return
        }
        attestRequestBuffer.reset()

        // Parse: [0x20] [sessionId:16] [cleartextHash:32] [cleartextLen:4] [cleartext:N]
        guard fullData.count >= 53,
              fullData[0] == BLEConstants.MessageType.attestRequest.rawValue else {
            NSLog("[BLE] Invalid attest request (len=%d)", fullData.count)
            return
        }

        let cleartextHash = fullData[17..<49]
        let cleartextLen = fullData[49..<53].withUnsafeBytes { $0.load(as: UInt32.self).littleEndian }
        let cleartext: String
        if cleartextLen > 0 && fullData.count >= 53 + Int(cleartextLen) {
            cleartext = String(data: fullData[53..<(53 + Int(cleartextLen))], encoding: .utf8) ?? ""
        } else {
            cleartext = ""
        }

        session.cleartext = cleartext
        NSLog("[BLE] Attest request: %d keystrokes, %d chars", session.keystrokeEvents.count, cleartext.count)
        delegate?.bleAttestationRequested(session, cleartext: cleartext, cleartextHash: Data(cleartextHash))
    }
}

// MARK: - CBPeripheralManagerDelegate

extension BLEPeripheralManager: CBPeripheralManagerDelegate {

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        NSLog("[BLE] State: %d", peripheral.state.rawValue)
        if peripheral.state == .poweredOn && isAdvertising {
            startAdvertising()
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            NSLog("[BLE] Failed to add service: %@", error.localizedDescription)
        } else {
            NSLog("[BLE] Service added successfully")
        }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            NSLog("[BLE] Advertising failed: %@", error.localizedDescription)
            isAdvertising = false
        } else {
            NSLog("[BLE] Advertising started")
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        NSLog("[BLE] Central subscribed to %@", characteristic.uuid.uuidString)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        NSLog("[BLE] Central unsubscribed from %@", characteristic.uuid.uuidString)
        if characteristic.uuid == BLEConstants.sessionUUID || characteristic.uuid == BLEConstants.attestResultUUID {
            if activeSession?.central.identifier == central.identifier {
                activeSession = nil
                delegate?.bleSessionEnded()
                NSLog("[BLE] Session ended (central unsubscribed)")
            }
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            guard let data = request.value else {
                peripheral.respond(to: request, withResult: .invalidAttributeValueLength)
                continue
            }

            switch request.characteristic.uuid {
            case BLEConstants.sessionUUID:
                handleSessionInit(data, from: request.central)
                peripheral.respond(to: request, withResult: .success)

            case BLEConstants.keystrokeUUID:
                handleKeystrokeEvent(data)
                // writeWithoutResponse — no respond needed

            case BLEConstants.attestRequestUUID:
                handleAttestRequest(data)
                peripheral.respond(to: request, withResult: .success)

            default:
                peripheral.respond(to: request, withResult: .attributeNotFound)
            }
        }
    }
}
