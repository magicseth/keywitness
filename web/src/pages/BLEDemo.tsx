import { useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Nav from "../components/Nav";
import { verifyAttestation, VerificationResult } from "../lib/verify";

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function VerificationCard({ result, encryptionKey, writerName, serverDeviceVerified, attestUrl }: { result: VerificationResult; encryptionKey?: string; writerName?: string; serverDeviceVerified?: boolean; attestUrl?: string }) {
  if (!result.valid) {
    return (
      <div className="rounded-2xl p-6 mb-6 bg-red-950/20 border border-red-900/30">
        <div className="text-red-400 text-lg font-bold mb-1">Verification failed</div>
        <p className="text-gray-500 text-sm">{result.error || "Signature could not be verified."}</p>
      </div>
    );
  }

  const hasKeystrokes = !!(result.keystrokeTimings && result.keystrokeTimings.length > 0);
  const deviceVerified = serverDeviceVerified || result.appAttestPresent;

  return (
    <div className="space-y-4">
      {/* Message card */}
      <div className="relative rounded-2xl overflow-hidden border border-gray-800/40" style={{ background: "linear-gradient(160deg, #141416 0%, #111113 60%, #0f1218 100%)" }}>
        <div className="px-8 pt-8 pb-6">
          {result.cleartext ? (
            <div className="relative pl-6">
              <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-green-500/25" />
              <blockquote className="text-[22px] leading-[1.45] text-white font-light tracking-[-0.01em]">
                {result.cleartext}
              </blockquote>
            </div>
          ) : result.encrypted ? (
            <div className="text-gray-500 text-sm">
              {result.cleartextLength ? `${result.cleartextLength} characters were typed` : "Content is encrypted"}
              {!encryptionKey && " — decryption key not available"}
            </div>
          ) : null}

          {/* Attribution line */}
          <div className="mt-6 pl-6 flex items-center gap-2 flex-wrap">
            <span className="text-gray-600">{"\u2014"}</span>
            <span className="text-white font-semibold text-[17px] italic tracking-tight">
              {writerName || "Someone"}
            </span>
            <span className="inline-flex items-center gap-1 text-green-400 text-xs font-semibold bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/15">
              <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
              </svg>
              human
            </span>
            {result.timestamp && (
              <span className="text-gray-600 text-xs ml-2">
                {formatTimestamp(result.timestamp)}
              </span>
            )}
          </div>
        </div>

        {/* Verification strip */}
        <div className="px-8 py-2.5 border-t border-gray-800/40 flex items-center gap-4 text-[11px] text-gray-600">
          <span className="text-green-500/70 flex items-center gap-1">
            <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            Verified
          </span>
          <span className={hasKeystrokes ? "text-green-500/50" : ""}>
            {hasKeystrokes ? "\u2713" : "\u2013"} Keystrokes
          </span>
          <span className={deviceVerified ? "text-green-500/50" : ""}>
            {deviceVerified ? "\u2713" : "\u2013"} Device
          </span>
          <span className={result.faceIdVerified ? "text-green-500/50" : ""}>
            {result.faceIdVerified ? "\u2713" : "\u2013"} Face ID
          </span>
        </div>
      </div>

      {/* Shareable link */}
      {attestUrl && (
        <div className="text-center">
          <a href={attestUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
            {attestUrl}
          </a>
        </div>
      )}

      {/* What this means */}
      <div className="rounded-xl bg-[#111111] border border-gray-800/60 p-6 space-y-3 text-sm text-gray-400">
        <div className="text-white font-semibold text-base mb-2">What this means</div>
        {hasKeystrokes && (
          <p>
            <span className="text-green-400 font-medium">Keystrokes verified</span> — this text was typed by hand, not pasted or generated. {result.keystrokeTimings!.length} keystroke events were recorded.
          </p>
        )}
        {deviceVerified && (
          <p>
            <span className="text-green-400 font-medium">Device verified</span> — Apple confirmed this came from a real, unmodified iPhone running the genuine KeyWitness app.
          </p>
        )}
        {result.faceIdVerified && (
          <p>
            <span className="text-green-400 font-medium">Face ID confirmed</span> — the person whose face unlocks this phone saw the message and approved it.
          </p>
        )}
        <p>
          <span className="text-green-400 font-medium">BLE proximity</span> — the phone was within Bluetooth range (~10m) when this was signed.
        </p>
        {!hasKeystrokes && !deviceVerified && !result.faceIdVerified && (
          <p>The cryptographic signature is valid — the text hasn't been modified since it was signed.</p>
        )}
      </div>

      {/* Technical details */}
      <details className="group">
        <summary className="text-xs text-gray-600 hover:text-gray-400 cursor-pointer transition-colors flex items-center gap-1.5">
          <span className="group-open:rotate-90 transition-transform">{"\u25B6"}</span>
          Technical details
        </summary>
        <div className="mt-3 rounded-xl bg-[#111111] border border-gray-800/60 divide-y divide-gray-800/60 text-sm overflow-hidden">
          {result.version && (
            <div className="px-5 py-3">
              <div className="text-xs text-gray-600 mb-0.5">Protocol</div>
              <span className="text-gray-300 font-mono text-xs">W3C VC 2.0 ({result.version})</span>
            </div>
          )}
          {result.issuerDID && (
            <div className="px-5 py-3">
              <div className="text-xs text-gray-600 mb-0.5">Issuer DID</div>
              <span className="text-gray-300 font-mono text-xs break-all">{result.issuerDID}</span>
            </div>
          )}
          {result.deviceId && (
            <div className="px-5 py-3">
              <div className="text-xs text-gray-600 mb-0.5">Device</div>
              <span className="text-gray-300 font-mono text-xs">{result.deviceId}</span>
            </div>
          )}
          {result.publicKeyFingerprint && (
            <div className="px-5 py-3">
              <div className="text-xs text-gray-600 mb-0.5">Key fingerprint</div>
              <span className="text-gray-300 font-mono text-xs">{result.publicKeyFingerprint}</span>
            </div>
          )}
          {result.proofs && result.proofs.length > 0 && (
            <div className="px-5 py-3">
              <div className="text-xs text-gray-600 mb-1.5">Proofs</div>
              <div className="space-y-1">
                {result.proofs.map((p, i) => {
                  // For device attestation, use server verification result if available
                  const isDeviceProof = p.proofType === "deviceAttestation";
                  const proofValid = isDeviceProof ? (serverDeviceVerified || p.valid) : p.valid;
                  const proofError = isDeviceProof && serverDeviceVerified ? undefined : p.error;
                  return (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className={proofValid ? "text-green-500" : "text-red-400"}>{proofValid ? "\u2713" : "\u2717"}</span>
                      <span className="text-gray-300">{p.proofType}</span>
                      {isDeviceProof && serverDeviceVerified && <span className="text-green-500/70">(server-verified)</span>}
                      {proofError && <span className="text-red-400/70">({proofError})</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export default function BLEDemo() {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [statusColor, setStatusColor] = useState("text-gray-500");
  const [connected, setConnected] = useState(false);
  const [deviceDID, setDeviceDID] = useState("");
  const [keystrokeCount, setKeystrokeCount] = useState(0);
  const [attestResult, setAttestResult] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [encryptionKey, setEncryptionKey] = useState<string | undefined>(undefined);
  const [attestError, setAttestError] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const [serverResult, setServerResult] = useState<{ deviceVerified?: boolean; url?: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectionRef = useRef<any>(null);
  const sessionStartRef = useRef(0);
  const keyDownTimesRef = useRef(new Map<string, number>());

  const keyRecord = useQuery(
    api.keys.getByPublicKey,
    verification?.publicKey ? { publicKey: verification.publicKey } : "skip",
  );

  const usernameRecord = useQuery(
    api.usernames.getByPublicKey,
    verification?.publicKey ? { publicKey: verification.publicKey } : "skip",
  );

  const writerName = keyRecord?.name
    || (usernameRecord?.username ? `@${usernameRecord.username}` : undefined)
    || (verification?.issuerDID ? `${verification.issuerDID.slice(8, 20)}…` : undefined);

  useEffect(() => {
    setSupported(typeof navigator !== "undefined" && "bluetooth" in navigator);
  }, []);

  const handleConnect = async () => {
    try {
      setStatus("Connecting\u2026");
      setStatusColor("text-yellow-400");

      // Dynamic import to avoid SSR issues
      const ble = await import("../embed/ble");
      const conn = await ble.connect();
      connectionRef.current = conn;
      setConnected(true);
      setDeviceDID(conn.session.deviceDID);
      setStatus("Connected");
      setStatusColor("text-green-400");
      setKeystrokeCount(0);

      conn.onDisconnect(() => {
        connectionRef.current = null;
        setConnected(false);
        setStatus("Disconnected");
        setStatusColor("text-yellow-400");
      });
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      setStatusColor("text-red-400");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!connectionRef.current) return;
    if (sessionStartRef.current === 0) sessionStartRef.current = performance.now();
    keyDownTimesRef.current.set(e.code, performance.now() - sessionStartRef.current);
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!connectionRef.current) return;
    const downAt = keyDownTimesRef.current.get(e.code);
    if (downAt === undefined) return;
    keyDownTimesRef.current.delete(e.code);

    const upAt = performance.now() - sessionStartRef.current;
    connectionRef.current.sendKeystroke(e.key, Math.round(downAt), Math.round(upAt));
    setKeystrokeCount((c: number) => c + 1);
  };

  const handleAttest = async () => {
    if (!connectionRef.current || !textareaRef.current) return;
    const cleartext = textareaRef.current.value;
    if (!cleartext.trim()) return;

    setAttesting(true);
    setAttestResult(null);
    setVerification(null);
    setAttestError(null);
    setStatus("Requesting attestation \u2014 check your phone\u2026");
    setStatusColor("text-yellow-400");

    try {
      const result = await connectionRef.current.requestAttestation(cleartext);
      if (result.status === "success") {
        setAttestResult(result.attestationBlock);
        setEncryptionKey(result.encryptionKey);
        setStatus("Attestation received! Verifying\u2026");
        setStatusColor("text-green-400");

        // Verify the attestation
        const vResult = await verifyAttestation(result.attestationBlock, result.encryptionKey, cleartext);
        // If decryption didn't produce cleartext but we have the typed text and verification passed,
        // hash-check and use it directly
        if (vResult.valid && !vResult.cleartext && vResult.cleartextHash) {
          const data = new TextEncoder().encode(cleartext);
          const hash = await crypto.subtle.digest("SHA-256", data);
          const bytes = new Uint8Array(hash);
          let binary = "";
          for (const b of bytes) binary += String.fromCharCode(b);
          const b64 = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
          if (b64 === vResult.cleartextHash) {
            vResult.cleartext = cleartext;
          }
        }
        setVerification(vResult);
        setStatus(vResult.valid ? "Verified!" : "Verification failed");
        setStatusColor(vResult.valid ? "text-green-400" : "text-red-400");

        // Upload to server for full verification (App Attest, device credential lookup)
        if (vResult.valid) {
          try {
            const resp = await fetch("/api/attestations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attestation: result.attestationBlock }),
            });
            if (resp.ok) {
              const serverData = await resp.json();
              setServerResult({
                deviceVerified: serverData.deviceVerified ?? false,
                url: serverData.url,
              });
            }
          } catch {
            // Server upload is best-effort — don't block the demo
          }
        }
      } else {
        setAttestError(`${result.status}: ${result.error || "unknown"}`);
        setStatus(result.status === "cancelled" ? "Cancelled on phone" : "Attestation failed");
        setStatusColor("text-red-400");
      }
    } catch (err) {
      setAttestError(err instanceof Error ? err.message : String(err));
      setStatus("Error");
      setStatusColor("text-red-400");
    } finally {
      setAttesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            BLE Web Attestation Demo
          </h1>
          <p className="text-gray-400">
            Type in the box below, then your iPhone signs the attestation via Bluetooth.
            No browser extension needed.
          </p>
        </div>

        {/* How it works */}
        <div className="border border-gray-800 rounded-lg p-5 mb-6 bg-[#111]">
          <h2 className="text-sm font-semibold text-gray-300 mb-3 uppercase tracking-wider">How it works</h2>
          <ol className="text-sm text-gray-400 space-y-1.5 list-decimal list-inside">
            <li>Open the KeyWitness app on your iPhone and enable <strong className="text-white">BLE Advertising</strong></li>
            <li>Click <strong className="text-white">Connect</strong> below to pair via Bluetooth</li>
            <li>Type something in the text box &mdash; keystroke timing flows to your phone in real time</li>
            <li>Click <strong className="text-white">Seal</strong> &mdash; your phone shows the text, you confirm with Face ID</li>
            <li>The signed attestation appears below, proving you typed it on a real Apple device</li>
          </ol>
        </div>

        {/* Browser support */}
        {!supported && (
          <div className="border border-red-900/50 bg-red-900/10 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">
              Web Bluetooth is not available in this browser. Try Chrome or Edge on desktop.
            </p>
          </div>
        )}

        {/* Connection */}
        <div className="border border-gray-800 rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className={`text-sm font-medium ${statusColor}`}>
                {connected ? "\u25CF" : "\u25CB"} {status}
              </div>
              {deviceDID && (
                <div className="text-xs text-gray-600 font-mono mt-1 truncate max-w-xs">
                  {deviceDID}
                </div>
              )}
            </div>
            <button
              onClick={handleConnect}
              disabled={connected || !supported}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 text-white"
            >
              {connected ? "Connected" : "Connect iPhone"}
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            onKeyDown={handleKeyDown}
            onKeyUp={handleKeyUp}
            disabled={!connected}
            placeholder={connected ? "Start typing here\u2026" : "Connect your iPhone first"}
            className="w-full h-40 bg-[#1a1a1c] border border-gray-700 rounded-lg p-3 text-white text-sm resize-none focus:outline-none focus:border-blue-500 disabled:opacity-50 placeholder:text-gray-600"
          />

          <div className="flex items-center justify-between mt-3">
            <span className="text-xs text-gray-500">
              {keystrokeCount > 0 ? `${keystrokeCount} keystroke${keystrokeCount === 1 ? "" : "s"} captured` : ""}
            </span>
            <button
              onClick={handleAttest}
              disabled={!connected || attesting}
              className="px-5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-green-600 hover:bg-green-500 text-white"
            >
              {attesting ? "Waiting for phone\u2026" : "Seal"}
            </button>
          </div>
        </div>

        {/* Verification result */}
        {verification && (
          <div className="mb-6">
            <VerificationCard result={verification} encryptionKey={encryptionKey} writerName={writerName} serverDeviceVerified={serverResult?.deviceVerified} attestUrl={serverResult?.url} />
          </div>
        )}

        {/* Raw attestation (collapsed) */}
        {attestResult && (
          <details className="mb-6 group">
            <summary className="text-xs text-gray-600 hover:text-gray-400 cursor-pointer transition-colors flex items-center gap-1.5">
              <span className="group-open:rotate-90 transition-transform">{"\u25B6"}</span>
              Raw attestation block
            </summary>
            <pre className="mt-2 text-xs text-gray-500 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto border border-gray-800 rounded-lg p-4 bg-[#111]">
              {attestResult}
            </pre>
          </details>
        )}

        {attestError && (
          <div className="border border-red-900/50 bg-red-900/10 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{attestError}</p>
          </div>
        )}

        {/* Security model (show when no verification result yet) */}
        {!verification && (
          <div className="border border-gray-800 rounded-lg p-5 text-xs text-gray-500">
            <h3 className="text-gray-400 font-semibold mb-2 uppercase tracking-wider text-[11px]">Security model</h3>
            <ul className="space-y-1">
              <li><strong className="text-gray-300">BLE proximity</strong> &mdash; phone must be within ~10m</li>
              <li><strong className="text-gray-300">Face ID</strong> &mdash; biometric confirmation on the phone</li>
              <li><strong className="text-gray-300">App Attest</strong> &mdash; Apple proves the device is real, not jailbroken</li>
              <li><strong className="text-gray-300">Ed25519 + eddsa-jcs-2022</strong> &mdash; W3C VC 2.0 signature</li>
              <li><strong className="text-gray-300">Puppeteer-resistant</strong> &mdash; automation can type, but can't make the phone confirm</li>
            </ul>
            <p className="mt-3">
              Works in Chrome and Edge. Requires the KeyWitness iOS app with BLE enabled.
            </p>
          </div>
        )}

        <footer className="text-center text-gray-600 text-xs py-8 mt-10 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400 transition-colors">keywitness.io</a>
          {" \u00B7 "}
          <a href="/developers" className="hover:text-gray-400 transition-colors">Developer Docs</a>
        </footer>
      </div>
    </div>
  );
}
