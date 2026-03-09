import { useEffect, useRef, useState } from "react";
import Nav from "../components/Nav";

export default function BLEDemo() {
  const [supported, setSupported] = useState(false);
  const [status, setStatus] = useState("Not connected");
  const [statusColor, setStatusColor] = useState("text-gray-500");
  const [connected, setConnected] = useState(false);
  const [deviceDID, setDeviceDID] = useState("");
  const [keystrokeCount, setKeystrokeCount] = useState(0);
  const [attestResult, setAttestResult] = useState<string | null>(null);
  const [attestError, setAttestError] = useState<string | null>(null);
  const [attesting, setAttesting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connectionRef = useRef<any>(null);
  const sessionStartRef = useRef(0);
  const keyDownTimesRef = useRef(new Map<string, number>());

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
    setAttestError(null);
    setStatus("Requesting attestation \u2014 check your phone\u2026");
    setStatusColor("text-yellow-400");

    try {
      const result = await connectionRef.current.requestAttestation(cleartext);
      if (result.status === "success") {
        setAttestResult(result.attestationBlock);
        setStatus("Attestation received!");
        setStatusColor("text-green-400");
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

        {/* Result */}
        {attestResult && (
          <div className="border border-green-900/50 bg-green-900/10 rounded-lg p-5 mb-6">
            <h3 className="text-green-400 text-sm font-semibold mb-2">Attestation Received</h3>
            <pre className="text-xs text-green-300/80 font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
              {attestResult}
            </pre>
          </div>
        )}

        {attestError && (
          <div className="border border-red-900/50 bg-red-900/10 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{attestError}</p>
          </div>
        )}

        {/* Technical details */}
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

        <footer className="text-center text-gray-600 text-xs py-8 mt-10 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400 transition-colors">keywitness.io</a>
          {" \u00B7 "}
          <a href="/developers" className="hover:text-gray-400 transition-colors">Developer Docs</a>
        </footer>
      </div>
    </div>
  );
}
