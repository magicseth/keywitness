import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { verifyAttestation, VerificationResult, KeystrokeTiming, ProofVerificationResult } from "../lib/verify";

// ── Known keys localStorage helpers ─────────────────────────────────────────

interface KnownKeyEntry {
  name: string;
  savedAt: number;
}

const KNOWN_KEYS_STORAGE_KEY = "keywitness-known-keys";

function getKnownKeys(): Record<string, KnownKeyEntry> {
  try {
    const raw = localStorage.getItem(KNOWN_KEYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function getKnownKey(publicKey: string): KnownKeyEntry | undefined {
  return getKnownKeys()[publicKey];
}

function saveKnownKey(publicKey: string, name: string): void {
  const keys = getKnownKeys();
  keys[publicKey] = { name, savedAt: Date.now() };
  localStorage.setItem(KNOWN_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

function removeKnownKey(publicKey: string): void {
  const keys = getKnownKeys();
  delete keys[publicKey];
  localStorage.setItem(KNOWN_KEYS_STORAGE_KEY, JSON.stringify(keys));
}

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

function proofTypeLabel(proofType: string): string {
  switch (proofType) {
    case "keystrokeAttestation": return "Keystroke Attestation";
    case "biometricVerification": return "Face ID Verification";
    case "deviceAttestation": return "Device Attestation";
    case "fingerprintVerification": return "Fingerprint Verification";
    case "hardwareAttestation": return "Hardware Attestation";
    default: return proofType;
  }
}

function proofTypeIcon(proofType: string, valid: boolean): string {
  if (!valid) return "x";
  switch (proofType) {
    case "keystrokeAttestation": return "K";
    case "biometricVerification": return "F";
    case "deviceAttestation": return "D";
    default: return "P";
  }
}

export default function Verify({ shortId }: { shortId?: string }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [manualCleartext, setManualCleartext] = useState("");
  const [knownKeyName, setKnownKeyName] = useState<string | undefined>(undefined);
  const [savingKeyName, setSavingKeyName] = useState(false);
  const [keyNameInput, setKeyNameInput] = useState("");
  const [, setKnownKeyVersion] = useState(0);

  const encryptionKey = window.location.hash.slice(1) || undefined;

  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("a") || shortId;

  const attestationDoc = useQuery(
    api.attestations.getByShortId,
    queryId ? { shortId: queryId } : "skip",
  );

  const keyRecord = useQuery(
    api.keys.getByPublicKey,
    result?.publicKey ? { publicKey: result.publicKey } : "skip",
  );

  const handleVerify = useCallback(
    async (text: string, manualText?: string) => {
      if (!text.trim()) return;
      setVerifying(true);
      try {
        const res = await verifyAttestation(text, encryptionKey, manualText);
        setResult(res);
        if (res.publicKey) {
          const known = getKnownKey(res.publicKey);
          setKnownKeyName(known?.name);
        }
      } finally {
        setVerifying(false);
      }
    },
    [encryptionKey],
  );

  useEffect(() => {
    if (attestationDoc?.attestation) {
      setInput(attestationDoc.attestation);
      handleVerify(attestationDoc.attestation);
    }
  }, [attestationDoc, handleVerify]);

  const onVerifyClick = () => handleVerify(input);

  const isError = result && !result.valid && !result.cleartext && !result.encrypted;
  const status = result
    ? result.valid
      ? "verified"
      : isError
        ? "error"
        : "invalid"
    : null;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            KeyWitness
          </h1>
          <p className="text-gray-400 text-lg">
            Was this written by a real person? Check here.
          </p>
        </div>

        {/* Input */}
        <div className="mb-6">
          <textarea
            className="w-full h-48 bg-[#111111] border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 resize-y"
            placeholder={`-----BEGIN KEYWITNESS ATTESTATION-----\n(paste attestation here)\n-----END KEYWITNESS ATTESTATION-----`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                onVerifyClick();
              }
            }}
          />
        </div>

        <div className="mb-8">
          <button
            onClick={onVerifyClick}
            disabled={verifying || !input.trim()}
            className="px-6 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {verifying ? "Checking..." : "Verify"}
          </button>
          <span className="ml-3 text-gray-600 text-sm">
            or press Cmd/Ctrl + Enter
          </span>
        </div>

        {/* Results */}
        {result && (
          <div className="border border-gray-800 rounded-lg overflow-hidden mb-10">
            {/* Status banner */}
            <div
              className={`px-5 py-3 flex items-center gap-3 ${
                status === "verified"
                  ? "bg-green-950/50 border-b border-green-900/50"
                  : status === "invalid"
                    ? "bg-red-950/50 border-b border-red-900/50"
                    : "bg-yellow-950/50 border-b border-yellow-900/50"
              }`}
            >
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${
                  status === "verified"
                    ? "bg-green-400"
                    : status === "invalid"
                      ? "bg-red-400"
                      : "bg-yellow-400"
                }`}
              />
              <span
                className={`font-semibold tracking-wide text-sm ${
                  status === "verified"
                    ? "text-green-400"
                    : status === "invalid"
                      ? "text-red-400"
                      : "text-yellow-400"
                }`}
              >
                {status === "verified"
                  ? "HUMAN"
                  : status === "invalid"
                    ? "SUSPICIOUS"
                    : "ERROR"}
              </span>
              <span className="text-gray-500 text-xs">
                {status === "verified"
                  ? "A real person typed this on a real device. It hasn't been changed."
                  : status === "invalid"
                    ? "Something doesn't add up. This message may have been altered or faked."
                    : ""}
              </span>
              {result.version && (
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                  {result.version}
                </span>
              )}
            </div>

            {/* Error message */}
            {result.error && (
              <div className="px-5 py-3 bg-[#111111] border-b border-gray-800">
                <p className="text-red-400 text-sm">{result.error}</p>
              </div>
            )}

            {/* Detail fields */}
            {!isError && (
              <div className="divide-y divide-gray-800">
                {/* Cleartext display */}
                {result.cleartext ? (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                      Message
                      {result.encrypted && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 font-medium uppercase">
                          Decrypted
                        </span>
                      )}
                    </div>
                    <div className="text-gray-200 text-sm break-all">
                      {result.cleartext}
                    </div>
                  </div>
                ) : result.encrypted && !result.cleartext ? (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                      Message
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 font-medium uppercase">
                        Locked
                      </span>
                    </div>
                    <div className="text-gray-500 text-sm italic mb-3">
                      {result.decryptionFailed
                        ? "Couldn't unlock the message. The link may be incomplete or the key is wrong."
                        : "This message is encrypted. Open the full link from the sender, or paste the original text below to check if it matches."}
                    </div>
                    <textarea
                      className="w-full h-24 bg-[#0a0a0a] border border-gray-700 rounded-lg p-3 font-mono text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 resize-y mb-2"
                      placeholder="Paste the original text here to check if it matches..."
                      value={manualCleartext}
                      onChange={(e) => setManualCleartext(e.target.value)}
                    />
                    <button
                      onClick={() => handleVerify(input, manualCleartext)}
                      disabled={verifying || !manualCleartext.trim()}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Check match
                    </button>
                  </div>
                ) : (
                  <Field label="Message" value={result.cleartext} />
                )}

                {/* Who wrote it */}
                {result.publicKey && (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Written By
                    </div>
                    <div
                      className={`text-sm font-medium ${
                        keyRecord
                          ? "text-green-400"
                          : keyRecord === null
                            ? "text-gray-400"
                            : "text-gray-500"
                      }`}
                    >
                      {keyRecord
                        ? keyRecord.name
                        : keyRecord === null
                          ? "Unknown sender (key not registered)"
                          : "Looking up..."}
                    </div>
                  </div>
                )}

                {/* Device */}
                <div className="px-5 py-3 bg-[#111111]">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                    Device
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-gray-200 text-sm">
                      {result.deviceId}
                    </span>
                    {attestationDoc?.deviceVerified ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 font-medium">
                        Real Apple device
                      </span>
                    ) : result?.appAttestPresent ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 font-medium">
                        Unconfirmed
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-medium">
                        Not verified
                      </span>
                    )}
                  </div>
                </div>

                {/* Face ID */}
                <div className="px-5 py-3 bg-[#111111]">
                  <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                    Face ID
                  </div>
                  {attestationDoc?.biometricSignature ? (
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 text-sm font-medium">
                        Confirmed by the sender
                      </span>
                      {attestationDoc.biometricTimestamp && (
                        <span className="text-gray-500 text-xs">
                          {Math.round((attestationDoc.biometricTimestamp - attestationDoc.createdAt) / 1000)}s after typing
                        </span>
                      )}
                    </div>
                  ) : attestationDoc && !attestationDoc.biometricSignature ? (
                    <span className="text-gray-500 text-sm">
                      Not confirmed
                    </span>
                  ) : (
                    <span className="text-gray-500 text-sm">Checking...</span>
                  )}
                </div>

                {/* Proof Chain (v3 only) */}
                {result.proofs && result.proofs.length > 0 && (
                  <ProofChain proofs={result.proofs} />
                )}

                {/* When */}
                <Field
                  label="When"
                  value={
                    result.timestamp
                      ? formatTimestamp(result.timestamp)
                      : undefined
                  }
                />

                {/* Identity */}
                {result.issuerDID && (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Issuer DID
                    </div>
                    <div className="text-gray-400 text-xs font-mono break-all">
                      {result.issuerDID}
                    </div>
                  </div>
                )}

                {/* Signing Key */}
                {result.publicKeyFingerprint && (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Signing Key
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-200 text-sm font-mono break-all">
                        {result.publicKeyFingerprint}
                      </span>
                      {result.publicKey && knownKeyName ? (
                        <span className="inline-flex items-center gap-1 text-sm text-green-400 font-medium">
                          {knownKeyName}
                          <button
                            onClick={() => {
                              removeKnownKey(result.publicKey!);
                              setKnownKeyName(undefined);
                              setKnownKeyVersion((v) => v + 1);
                            }}
                            className="text-gray-500 hover:text-red-400 text-xs ml-1"
                            title="Forget this key"
                          >
                            x
                          </button>
                        </span>
                      ) : result.publicKey && !savingKeyName ? (
                        <button
                          onClick={() => setSavingKeyName(true)}
                          className="text-xs text-gray-500 hover:text-blue-400 transition-colors"
                        >
                          Remember this key
                        </button>
                      ) : null}
                    </div>
                    {savingKeyName && result.publicKey && (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="text"
                          className="bg-[#0a0a0a] border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
                          placeholder="Name this person..."
                          value={keyNameInput}
                          onChange={(e) => setKeyNameInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && keyNameInput.trim()) {
                              saveKnownKey(result.publicKey!, keyNameInput.trim());
                              setKnownKeyName(keyNameInput.trim());
                              setSavingKeyName(false);
                              setKeyNameInput("");
                              setKnownKeyVersion((v) => v + 1);
                            } else if (e.key === "Escape") {
                              setSavingKeyName(false);
                              setKeyNameInput("");
                            }
                          }}
                          autoFocus
                        />
                        <button
                          onClick={() => {
                            if (keyNameInput.trim()) {
                              saveKnownKey(result.publicKey!, keyNameInput.trim());
                              setKnownKeyName(keyNameInput.trim());
                              setSavingKeyName(false);
                              setKeyNameInput("");
                              setKnownKeyVersion((v) => v + 1);
                            }
                          }}
                          disabled={!keyNameInput.trim()}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setSavingKeyName(false);
                            setKeyNameInput("");
                          }}
                          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Keystroke Timeline */}
            {result.keystrokeTimings &&
              result.keystrokeTimings.length > 0 && (
                <KeystrokeTimeline timings={result.keystrokeTimings} />
              )}
          </div>
        )}

        {/* Explanation */}
        <div className="border border-gray-800 rounded-lg p-6 mb-10">
          <h2 className="text-lg font-semibold text-white mb-4">
            How does this work?
          </h2>
          <div className="space-y-4 text-sm text-gray-400">
            <p>
              KeyWitness is a keyboard for iPhone that seals every message you type with a
              digital signature. When someone receives your message, they can verify here
              that it really came from you and hasn't been edited.
            </p>
            <div>
              <h3 className="text-gray-300 font-medium mb-1">
                A green "Authentic" result means:
              </h3>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>
                  The message is word-for-word what was originally typed
                </li>
                <li>
                  It was typed on the device shown above
                </li>
                <li>
                  Nobody has modified it since it was written
                </li>
                <li>
                  If device-verified: it came from the real KeyWitness app on a genuine iPhone, not a fake
                </li>
                <li>
                  If Face ID confirmed: the device owner personally verified the message
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-gray-300 font-medium mb-1">
                Standards
              </h3>
              <p>
                KeyWitness v3 attestations use{" "}
                <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                  W3C Verifiable Credentials 2.0
                </a>{" "}
                with the{" "}
                <a href="https://www.w3.org/TR/vc-di-eddsa/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                  eddsa-jcs-2022
                </a>{" "}
                Data Integrity cryptosuite. Any VC-compatible verifier can validate them.
              </p>
            </div>
            <div>
              <h3 className="text-gray-300 font-medium mb-1">
                It does not prove:
              </h3>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>Who the person behind the device is (unless they've registered their name)</li>
                <li>
                  That the message was typed voluntarily
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-gray-600 text-xs py-6 border-t border-gray-800 space-y-2">
          <div>
            Verification happens entirely in your browser. Nothing is sent to any server.
          </div>
          <div>
            <a href="/how" className="text-gray-500 hover:text-gray-300 transition-colors">
              Learn more about KeyWitness
            </a>
          </div>
        </footer>
      </div>
    </div>
  );
}

// ── Proof Chain component (v3 multi-proof) ──────────────────────────────────

function ProofChain({ proofs }: { proofs: ProofVerificationResult[] }) {
  return (
    <div className="px-5 py-3 bg-[#111111]">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
        Proof Chain
      </div>
      <div className="space-y-2">
        {proofs.map((proof, i) => (
          <div key={i} className="flex items-center gap-3">
            <div
              className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                proof.valid
                  ? "bg-green-900/50 text-green-400 border border-green-800"
                  : "bg-red-900/50 text-red-400 border border-red-800"
              }`}
            >
              {proofTypeIcon(proof.proofType, proof.valid)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-medium ${proof.valid ? "text-green-400" : "text-red-400"}`}>
                  {proofTypeLabel(proof.proofType)}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  proof.valid
                    ? "bg-green-900/50 text-green-400"
                    : "bg-red-900/50 text-red-400"
                }`}>
                  {proof.valid ? "VALID" : "FAILED"}
                </span>
              </div>
              {proof.error && (
                <div className="text-xs text-red-400 mt-0.5">{proof.error}</div>
              )}
              {proof.details && (
                <div className="text-xs text-gray-600 mt-0.5">
                  {proof.details.created && <span>{formatTimestamp(proof.details.created as string)}</span>}
                  {proof.details.verifiedBy && <span> (verified by {proof.details.verifiedBy as string})</span>}
                </div>
              )}
            </div>
            {i < proofs.length - 1 && (
              <div className="w-px h-4 bg-gray-700 ml-3" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value?: string;
  mono?: boolean;
}) {
  if (!value) return null;
  return (
    <div className="px-5 py-3 bg-[#111111]">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div
        className={`text-gray-200 text-sm break-all ${mono ? "font-mono" : ""}`}
      >
        {value}
      </div>
    </div>
  );
}

function KeystrokeTimeline({
  timings,
}: {
  timings: KeystrokeTiming[];
}) {
  const totalDuration = Math.max(...timings.map((t) => t.upAt));
  const maxBarWidth = 300;
  const scale = totalDuration > 0 ? maxBarWidth / totalDuration : 1;
  const hasBiometrics = timings.some((t) => t.x !== undefined);

  return (
    <div className="border-t border-gray-800 bg-[#111111] px-5 py-4">
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
        Typing Pattern
      </div>
      <p className="text-xs text-gray-600 mb-3">
        How each key was typed ({(totalDuration / 1000).toFixed(1)}s total). This pattern is unique to the typist, like a fingerprint.
      </p>
      <div className="space-y-1">
        {timings.map((timing, i) => {
          const dwell = Math.round(timing.upAt - timing.downAt);
          const gap =
            i > 0
              ? Math.round(timing.downAt - timings[i - 1].upAt)
              : null;
          const barLeft = timing.downAt * scale;
          const barWidth = Math.max((timing.upAt - timing.downAt) * scale, 2);
          const displayKey =
            timing.key === " " ? "\u2423" : timing.key;

          return (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="font-mono text-gray-300 w-4 text-center shrink-0">
                {displayKey}
              </span>
              <span className="text-gray-500 w-16 text-right shrink-0 tabular-nums">
                {Math.round(timing.downAt)}ms
              </span>
              <div
                className="relative h-3 shrink-0"
                style={{ width: `${maxBarWidth}px` }}
              >
                <div
                  className="absolute top-0 h-full bg-blue-500/60 rounded-sm"
                  style={{
                    left: `${barLeft}px`,
                    width: `${barWidth}px`,
                  }}
                />
              </div>
              <span className="text-gray-500 shrink-0 tabular-nums">
                {dwell}ms
                {gap !== null ? <span className="text-gray-600"> +{gap}</span> : ""}
              </span>
            </div>
          );
        })}
      </div>
      {hasBiometrics && (
        <div className="mt-4 border-t border-gray-800 pt-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
            Touch Map
          </div>
          <p className="text-[10px] text-gray-600 mb-2">
            Where each key was pressed. Brightness shows how firmly it was touched.
          </p>
          <div className="flex flex-wrap gap-1">
            {timings.map((t, i) => {
              const displayKey = t.key === " " ? "\u2423" : t.key;
              const maxRadius = Math.max(...timings.map((tt) => tt.radius ?? 0), 1);
              const radiusNorm = (t.radius ?? 0) / maxRadius;
              const opacity = Math.max(0.25, radiusNorm);
              const dotX = t.x !== undefined ? Math.min(Math.max(t.x / 2, 2), 22) : 12;
              const dotY = t.y !== undefined ? Math.min(Math.max(t.y / 2, 2), 22) : 12;
              return (
                <div
                  key={i}
                  className="relative flex items-center justify-center rounded text-[10px] font-mono text-white border border-gray-700"
                  style={{
                    width: 28,
                    height: 28,
                    backgroundColor: `rgba(59, 130, 246, ${opacity})`,
                  }}
                  title={`Position: (${t.x?.toFixed(1)}, ${t.y?.toFixed(1)}) Force: ${t.force?.toFixed(3)} Radius: ${t.radius?.toFixed(1)}`}
                >
                  {displayKey}
                  <div
                    className="absolute w-1.5 h-1.5 rounded-full bg-white/60"
                    style={{ left: `${dotX}px`, top: `${dotY}px` }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
