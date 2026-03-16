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
    /// Called when advertising actually starts (or fails).
    func bleAdvertisingStateChanged(advertising: Bool, error: String?)
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

    /// User wants to advertise — set when toggle is on.
    /// Actual advertising starts when both this is true AND the service is registered.
    private var wantsToAdvertise = false
    private var serviceRegistered = false

    /// Queue of chunks waiting to be sent when the transmit buffer has space.
    private var pendingChunks: [(data: Data, central: CBCentral)] = []

    override init() {
        super.init()
        peripheralManager = CBPeripheralManager(delegate: self, queue: .main)
    }

    // MARK: - Public API

    func startAdvertising() {
        wantsToAdvertise = true

        guard peripheralManager.state == .poweredOn else {
            NSLog("[BLE] Bluetooth not powered on yet (state=%d), will advertise when ready", peripheralManager.state.rawValue)
            return
        }

        // Add service if not yet added
        if service == nil {
            setupService()
            // Advertising will start in didAdd callback
            return
        }

        // Service already registered, start now
        if serviceRegistered && !isAdvertising {
            beginAdvertising()
        }
    }

    func stopAdvertising() {
        wantsToAdvertise = false
        peripheralManager.stopAdvertising()
        isAdvertising = false
        activeSession = nil
        NSLog("[BLE] Stopped advertising")
    }

    private func beginAdvertising() {
        guard !isAdvertising else { return }
        peripheralManager.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [BLEConstants.serviceUUID],
            CBAdvertisementDataLocalNameKey: BLEConstants.localName,
        ])
        NSLog("[BLE] Requested start advertising")
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
            var totalLE = totalChunks.littleEndian
            chunk.append(Data(bytes: &totalLE, count: 2))
            var indexLE = i.littleEndian
            chunk.append(Data(bytes: &indexLE, count: 2))
            chunk.append(chunkPayload)

            let sent = peripheralManager.updateValue(chunk, for: characteristic, onSubscribedCentrals: [session.central])
            if !sent {
                // Queue is full — buffer remaining chunks for peripheralManagerIsReady
                NSLog("[BLE] Transmit queue full at chunk %d/%d, queuing remainder", i, totalChunks)
                pendingChunks.append((data: chunk, central: session.central))
                // Queue the rest too
                for j in (Int(i) + 1)..<Int(totalChunks) {
                    let s = j * chunkSize
                    let e = min(s + chunkSize, payload.count)
                    let cp = payload[s..<e]
                    var c = Data()
                    c.append(result.status.rawValue)
                    var tLE = totalChunks.littleEndian
                    c.append(Data(bytes: &tLE, count: 2))
                    var jLE = UInt16(j).littleEndian
                    c.append(Data(bytes: &jLE, count: 2))
                    c.append(cp)
                    pendingChunks.append((data: c, central: session.central))
                }
                NSLog("[BLE] Queued %d chunks total", pendingChunks.count)
                return
            } else {
                NSLog("[BLE] Sent chunk %d/%d (%d bytes)", i + 1, totalChunks, chunk.count)
            }
        }

        NSLog("[BLE] All %d chunks sent successfully", totalChunks)
    }

    /// Drain the pending chunk queue when the transmit buffer has space.
    private func drainPendingChunks() {
        guard let characteristic = attestResultCharacteristic else { return }

        while !pendingChunks.isEmpty {
            let next = pendingChunks[0]
            let sent = peripheralManager.updateValue(next.data, for: characteristic, onSubscribedCentrals: [next.central])
            if sent {
                pendingChunks.removeFirst()
                NSLog("[BLE] Drained queued chunk (%d remaining)", pendingChunks.count)
            } else {
                NSLog("[BLE] Queue still full, %d chunks remaining", pendingChunks.count)
                return // Will be called again from peripheralManagerIsReady
            }
        }
        NSLog("[BLE] All queued chunks drained")
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
        NSLog("[BLE] Service setup requested (waiting for didAdd callback)")
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

        // Read UInt32 values byte-by-byte to avoid alignment issues
        let downOffset = 2 + keyLen
        let downAt = readUInt32LE(data, offset: downOffset)
        let upAt = readUInt32LE(data, offset: downOffset + 4)

        let event = BLEKeystrokeEvent(key: key, downAtMs: downAt, upAtMs: upAt)
        session.keystrokeEvents.append(event)
        delegate?.bleKeystrokeReceived(session, count: session.keystrokeEvents.count)
    }

    private func handleAttestRequest(_ data: Data) {
        guard let session = activeSession else { return }

        // Check if this is a chunked message
        // [chunkIndex:2] [totalChunks:2] [payload:N]
        guard data.count >= 4 else { return }

        let chunkIndex = readUInt16LE(data, offset: 0)
        let totalChunks = readUInt16LE(data, offset: 2)
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
            NSLog("[BLE] Invalid attest request (len=%d, first=0x%02X)", fullData.count, fullData.first ?? 0)
            return
        }

        let cleartextHash = fullData[17..<49]
        let cleartextLen = readUInt32LE(fullData, offset: 49)
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

    // MARK: - Safe byte reading (avoids alignment crashes)

    private func readUInt16LE(_ data: Data, offset: Int) -> UInt16 {
        return UInt16(data[data.startIndex + offset]) |
               UInt16(data[data.startIndex + offset + 1]) << 8
    }

    private func readUInt32LE(_ data: Data, offset: Int) -> UInt32 {
        return UInt32(data[data.startIndex + offset]) |
               UInt32(data[data.startIndex + offset + 1]) << 8 |
               UInt32(data[data.startIndex + offset + 2]) << 16 |
               UInt32(data[data.startIndex + offset + 3]) << 24
    }
}

// MARK: - CBPeripheralManagerDelegate

extension BLEPeripheralManager: CBPeripheralManagerDelegate {

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        NSLog("[BLE] State changed: %d", peripheral.state.rawValue)
        if peripheral.state == .poweredOn && wantsToAdvertise {
            startAdvertising()
        }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if let error = error {
            NSLog("[BLE] Failed to add service: %@", error.localizedDescription)
            delegate?.bleAdvertisingStateChanged(advertising: false, error: "Service failed: \(error.localizedDescription)")
            return
        }

        NSLog("[BLE] Service added successfully — now starting advertising")
        serviceRegistered = true

        // Now that the service is registered, start advertising if the user wants it
        if wantsToAdvertise {
            beginAdvertising()
        }
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager, error: Error?) {
        if let error = error {
            NSLog("[BLE] Advertising failed: %@", error.localizedDescription)
            isAdvertising = false
            delegate?.bleAdvertisingStateChanged(advertising: false, error: error.localizedDescription)
        } else {
            NSLog("[BLE] Advertising started successfully")
            isAdvertising = true
            delegate?.bleAdvertisingStateChanged(advertising: true, error: nil)
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

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        NSLog("[BLE] Ready to send more data")
        drainPendingChunks()
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        NSLog("[BLE] didReceiveWrite: %d request(s)", requests.count)

        // Must respond to the FIRST request (Apple docs: respond to the first, it covers all)
        var firstRequest: CBATTRequest?

        for request in requests {
            if firstRequest == nil && request.characteristic.properties.contains(.write) {
                firstRequest = request
            }

            guard let data = request.value else {
                NSLog("[BLE] Write request with no data for %@", request.characteristic.uuid.uuidString)
                continue
            }

            NSLog("[BLE] Write to %@: %d bytes, first byte=0x%02X", request.characteristic.uuid.uuidString, data.count, data.first ?? 0)

            switch request.characteristic.uuid {
            case BLEConstants.sessionUUID:
                handleSessionInit(data, from: request.central)

            case BLEConstants.keystrokeUUID:
                handleKeystrokeEvent(data)

            case BLEConstants.attestRequestUUID:
                handleAttestRequest(data)

            default:
                NSLog("[BLE] Unknown characteristic: %@", request.characteristic.uuid.uuidString)
            }
        }

        // Respond to the first write request (covers all requests in the batch)
        if let first = firstRequest {
            peripheral.respond(to: first, withResult: .success)
        }
    }
}
