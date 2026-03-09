/**
 * KeyWitness BLE Client
 *
 * Connects to a KeyWitness iPhone via Web Bluetooth to send keystroke
 * timing data and receive signed attestations.
 *
 * The phone acts as the trust anchor — it confirms the text via Face ID
 * and signs with App Attest + Ed25519.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Constants ──────────────────────────────────────────────────────────────

const SERVICE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const SESSION_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234560001";
const KEYSTROKE_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234560002";
const ATTEST_REQUEST_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234560003";
const ATTEST_RESULT_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234560004";

const MSG_KEYSTROKE = 0x01;
const MSG_SESSION_INIT = 0x10;
const MSG_SESSION_ACK = 0x11;
const MSG_ATTEST_REQUEST = 0x20;

const PROTOCOL_VERSION = 1;
const CHUNK_SIZE = 180;

// ── Types ──────────────────────────────────────────────────────────────────

export interface BLESessionInfo {
  sessionId: Uint8Array;
  devicePublicKey: Uint8Array;
  deviceDID: string;
}

export interface BLEAttestationResult {
  status: "success" | "cancelled" | "error";
  attestationBlock?: string;
  encryptionKey?: string;
  error?: string;
}

export interface BLEConnection {
  /** Session info from the connected phone. */
  session: BLESessionInfo;
  /** Send a keystroke event to the phone. */
  sendKeystroke(key: string, downAtMs: number, upAtMs: number): void;
  /** Request attestation — triggers Face ID on the phone. Returns the signed VC. */
  requestAttestation(cleartext: string): Promise<BLEAttestationResult>;
  /** Disconnect from the phone. */
  disconnect(): void;
  /** Register a disconnect callback. */
  onDisconnect(cb: () => void): void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const hash = await crypto.subtle.digest("SHA-256", ab);
  return new Uint8Array(hash);
}

// ── BLE Client ─────────────────────────────────────────────────────────────

/**
 * Check if Web Bluetooth is available in this browser.
 */
export function isSupported(): boolean {
  return typeof navigator !== "undefined" && "bluetooth" in navigator;
}

/**
 * Connect to a KeyWitness iPhone via BLE.
 * Prompts the user to select a device.
 */
export async function connect(): Promise<BLEConnection> {
  if (!isSupported()) {
    throw new Error("Web Bluetooth is not supported in this browser (try Chrome or Edge)");
  }

  const bt = (navigator as any).bluetooth;

  // Request device with KeyWitness service filter
  const device: any = await bt.requestDevice({
    filters: [{ services: [SERVICE_UUID] }],
  });

  if (!device.gatt) throw new Error("No GATT server on device");

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(SERVICE_UUID);

  // Get characteristics
  const sessionChar = await service.getCharacteristic(SESSION_UUID);
  const keystrokeChar = await service.getCharacteristic(KEYSTROKE_UUID);
  const attestRequestChar = await service.getCharacteristic(ATTEST_REQUEST_UUID);
  const attestResultChar = await service.getCharacteristic(ATTEST_RESULT_UUID);

  // Subscribe to session ack notifications
  await sessionChar.startNotifications();

  // Send session init
  const nonce = randomBytes(16);
  const initMsg = new Uint8Array(18);
  initMsg[0] = MSG_SESSION_INIT;
  initMsg[1] = PROTOCOL_VERSION;
  initMsg.set(nonce, 2);

  // Wait for session ack
  const sessionInfo = await new Promise<BLESessionInfo>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Session handshake timeout")), 10000);

    const handler = (event: any) => {
      const value = event.target?.value as DataView | undefined;
      if (!value || value.getUint8(0) !== MSG_SESSION_ACK) return;

      clearTimeout(timeout);
      sessionChar.removeEventListener("characteristicvaluechanged", handler);

      const sessionId = new Uint8Array(value.buffer, value.byteOffset + 1, 16);
      const publicKey = new Uint8Array(value.buffer, value.byteOffset + 17, 32);
      const didLen = value.getUint8(49);
      const didBytes = new Uint8Array(value.buffer, value.byteOffset + 50, didLen);
      const deviceDID = new TextDecoder().decode(didBytes);

      resolve({ sessionId, devicePublicKey: publicKey, deviceDID });
    };

    sessionChar.addEventListener("characteristicvaluechanged", handler);
    sessionChar.writeValue(initMsg).catch(reject);
  });

  // Disconnect callbacks
  const disconnectCallbacks: Array<() => void> = [];
  device.addEventListener("gattserverdisconnected", () => {
    disconnectCallbacks.forEach((cb: () => void) => cb());
  });

  // Buffered keystrokes for reconnection
  let connected = true;

  return {
    session: sessionInfo,

    sendKeystroke(key: string, downAtMs: number, upAtMs: number) {
      if (!connected) return;

      const keyBytes = new TextEncoder().encode(key);
      const msg = new Uint8Array(2 + keyBytes.length + 8);
      msg[0] = MSG_KEYSTROKE;
      msg[1] = keyBytes.length;
      msg.set(keyBytes, 2);

      const view = new DataView(msg.buffer, msg.byteOffset);
      view.setUint32(2 + keyBytes.length, downAtMs, true);
      view.setUint32(2 + keyBytes.length + 4, upAtMs, true);

      keystrokeChar.writeValueWithoutResponse(msg).catch(() => {
        // Silently drop on failure
      });
    },

    async requestAttestation(cleartext: string): Promise<BLEAttestationResult> {
      // Subscribe to attestation result notifications
      await attestResultChar.startNotifications();

      // Build attestation request
      const cleartextBytes = new TextEncoder().encode(cleartext);
      const cleartextHash = await sha256(cleartextBytes);

      // [0x20] [sessionId:16] [cleartextHash:32] [cleartextLen:4] [cleartext:N]
      const payload = new Uint8Array(1 + 16 + 32 + 4 + cleartextBytes.length);
      const payloadView = new DataView(payload.buffer);
      let offset = 0;

      payload[offset++] = MSG_ATTEST_REQUEST;
      payload.set(sessionInfo.sessionId, offset); offset += 16;
      payload.set(cleartextHash, offset); offset += 32;
      payloadView.setUint32(offset, cleartextBytes.length, true); offset += 4;
      payload.set(cleartextBytes, offset);

      // Chunk and send
      const totalChunks = Math.ceil(payload.length / CHUNK_SIZE);
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, payload.length);
        const chunkPayload = payload.slice(start, end);

        // [chunkIndex:2] [totalChunks:2] [payload:N]
        const chunk = new Uint8Array(4 + chunkPayload.length);
        const chunkView = new DataView(chunk.buffer);
        chunkView.setUint16(0, i, true);
        chunkView.setUint16(2, totalChunks, true);
        chunk.set(chunkPayload, 4);

        await attestRequestChar.writeValue(chunk);
      }

      // Wait for result (chunked notifications)
      return new Promise<BLEAttestationResult>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error("Attestation timeout (60s) — user may not have confirmed"));
        }, 60000);

        const resultChunks: Map<number, Uint8Array> = new Map();
        let expectedTotal = 0;
        let resultStatus = 0;

        const handler = (event: any) => {
          const value = event.target?.value as DataView | undefined;
          if (!value || value.byteLength < 5) return;

          // [status:1] [totalChunks:2] [chunkIndex:2] [payload:N]
          const status = value.getUint8(0);
          const total = value.getUint16(1, true);
          const index = value.getUint16(3, true);
          const chunkData = new Uint8Array(value.buffer, value.byteOffset + 5);

          resultStatus = status;
          expectedTotal = total;
          resultChunks.set(index, chunkData);

          if (resultChunks.size === expectedTotal) {
            cleanup();

            // Reassemble
            let totalLen = 0;
            for (const c of resultChunks.values()) totalLen += c.length;
            const full = new Uint8Array(totalLen);
            let pos = 0;
            for (let j = 0; j < expectedTotal; j++) {
              const c = resultChunks.get(j)!;
              full.set(c, pos);
              pos += c.length;
            }

            const text = new TextDecoder().decode(full);

            if (resultStatus === 0x00) {
              // Success: block + newline + key
              const newlineIdx = text.lastIndexOf("\n");
              if (newlineIdx === -1) {
                resolve({ status: "success", attestationBlock: text });
              } else {
                resolve({
                  status: "success",
                  attestationBlock: text.substring(0, newlineIdx),
                  encryptionKey: text.substring(newlineIdx + 1),
                });
              }
            } else if (resultStatus === 0x01) {
              resolve({ status: "cancelled", error: text });
            } else {
              resolve({ status: "error", error: text });
            }
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          attestResultChar.removeEventListener("characteristicvaluechanged", handler);
        };

        attestResultChar.addEventListener("characteristicvaluechanged", handler);
      });
    },

    disconnect() {
      connected = false;
      device.gatt?.disconnect();
    },

    onDisconnect(cb: () => void) {
      disconnectCallbacks.push(cb);
    },
  };
}

/**
 * High-level API: attach KeyWitness BLE attestation to a form.
 *
 * Usage:
 *   KeyWitness.attestForm('#my-form', '#my-textarea', {
 *     onAttestation: (result) => console.log(result),
 *   });
 */
export function attestForm(
  formSelector: string,
  textareaSelector: string,
  options?: {
    onConnected?: (session: BLESessionInfo) => void;
    onKeystroke?: (count: number) => void;
    onAttestation?: (result: BLEAttestationResult) => void;
    autoSubmit?: boolean;
  },
): () => void {
  const form = document.querySelector<HTMLFormElement>(formSelector);
  const textarea = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(textareaSelector);
  if (!form || !textarea) throw new Error("KeyWitness BLE: form or textarea not found");

  let connection: BLEConnection | null = null;
  let keystrokeCount = 0;
  let sessionStart = 0;

  // Create connect button
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Connect KeyWitness";
  btn.style.cssText =
    "background:#3366ff;color:#fff;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:14px;margin:8px 0;";
  form.insertBefore(btn, textarea.nextSibling);

  // Status indicator
  const statusEl = document.createElement("div");
  statusEl.style.cssText = "font-size:13px;margin:4px 0;color:#888;";
  form.insertBefore(statusEl, btn.nextSibling);

  const handleConnect = async () => {
    try {
      btn.textContent = "Connecting\u2026";
      btn.disabled = true;
      connection = await connect();
      btn.textContent = `Connected: ${connection.session.deviceDID.slice(0, 20)}\u2026`;
      btn.style.background = "#22c55e";
      statusEl.textContent = "Listening for keystrokes\u2026";
      statusEl.style.color = "#22c55e";

      options?.onConnected?.(connection.session);

      connection.onDisconnect(() => {
        connection = null;
        btn.textContent = "Reconnect KeyWitness";
        btn.disabled = false;
        btn.style.background = "#3366ff";
        statusEl.textContent = "Disconnected";
        statusEl.style.color = "#f59e0b";
      });
    } catch (err) {
      btn.textContent = "Connect KeyWitness";
      btn.disabled = false;
      statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      statusEl.style.color = "#ef4444";
    }
  };

  btn.addEventListener("click", handleConnect);

  // Keystroke capture
  const keyDownTimes = new Map<string, number>();

  const handleKeyDownRecord = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (!connection) return;
    if (sessionStart === 0) sessionStart = performance.now();
    keyDownTimes.set(ke.code, performance.now() - sessionStart);
  };

  const handleKeyUp = (e: Event) => {
    const ke = e as KeyboardEvent;
    if (!connection) return;
    const downAt = keyDownTimes.get(ke.code);
    if (downAt === undefined) return;
    keyDownTimes.delete(ke.code);

    const upAt = performance.now() - sessionStart;
    connection.sendKeystroke(ke.key, Math.round(downAt), Math.round(upAt));
    keystrokeCount++;
    statusEl.textContent = `${keystrokeCount} keystroke${keystrokeCount === 1 ? "" : "s"} captured`;
    options?.onKeystroke?.(keystrokeCount);
  };

  textarea.addEventListener("keydown", handleKeyDownRecord);
  textarea.addEventListener("keyup", handleKeyUp);

  // Form submit handler
  const handleSubmit = async (e: Event) => {
    if (!connection) return; // let normal submit proceed
    e.preventDefault();

    statusEl.textContent = "Requesting attestation \u2014 check your phone\u2026";
    statusEl.style.color = "#f59e0b";

    try {
      const cleartext = (textarea as HTMLTextAreaElement).value;
      const result = await connection.requestAttestation(cleartext);

      if (result.status === "success" && result.attestationBlock) {
        // Add hidden inputs for the attestation
        const attestInput = document.createElement("input");
        attestInput.type = "hidden";
        attestInput.name = "keywitness_attestation";
        attestInput.value = result.attestationBlock;
        form.appendChild(attestInput);

        if (result.encryptionKey) {
          const keyInput = document.createElement("input");
          keyInput.type = "hidden";
          keyInput.name = "keywitness_key";
          keyInput.value = result.encryptionKey;
          form.appendChild(keyInput);
        }

        statusEl.textContent = "Attestation received!";
        statusEl.style.color = "#22c55e";
        options?.onAttestation?.(result);

        if (options?.autoSubmit !== false) {
          form.submit();
        }
      } else {
        statusEl.textContent = `Attestation ${result.status}: ${result.error || "unknown"}`;
        statusEl.style.color = "#ef4444";
        options?.onAttestation?.(result);
      }
    } catch (err) {
      statusEl.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
      statusEl.style.color = "#ef4444";
    }
  };

  form.addEventListener("submit", handleSubmit);

  // Return cleanup function
  return () => {
    btn.remove();
    statusEl.remove();
    textarea.removeEventListener("keydown", handleKeyDownRecord);
    textarea.removeEventListener("keyup", handleKeyUp);
    form.removeEventListener("submit", handleSubmit);
    connection?.disconnect();
  };
}
