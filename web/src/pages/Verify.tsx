import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { verifyAttestation, VerificationResult, KeystrokeTiming } from "../lib/verify";

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

export default function Verify({ shortId }: { shortId?: string }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [manualCleartext, setManualCleartext] = useState("");
  const [knownKeyName, setKnownKeyName] = useState<string | undefined>(undefined);
  const [savingKeyName, setSavingKeyName] = useState(false);
  const [keyNameInput, setKeyNameInput] = useState("");
  const [, setKnownKeyVersion] = useState(0); // force re-render on known key changes

  // Read encryption key from URL fragment
  const encryptionKey = window.location.hash.slice(1) || undefined;

  // Also check for ?a= query param
  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("a") || shortId;

  const attestationDoc = useQuery(
    api.attestations.getByShortId,
    queryId ? { shortId: queryId } : "skip",
  );

  // Look up the public key in the registry after verification
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

  // Auto-load attestation from Convex when fetched
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
            Cryptographic text verification. Paste an attestation block below to
            verify its authenticity.
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
            {verifying ? "Verifying..." : "Verify"}
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
                  ? "VERIFIED"
                  : status === "invalid"
                    ? "INVALID"
                    : "ERROR"}
              </span>
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
                      Cleartext
                      {result.encrypted && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 font-medium uppercase">
                          Encrypted
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
                      Cleartext
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 font-medium uppercase">
                        Encrypted
                      </span>
                    </div>
                    <div className="text-gray-500 text-sm italic mb-3">
                      {result.decryptionFailed
                        ? "Decryption failed — wrong key or corrupted data."
                        : "Cleartext is encrypted. Provide the decryption key in the URL fragment or paste the original text below."}
                    </div>
                    <textarea
                      className="w-full h-24 bg-[#0a0a0a] border border-gray-700 rounded-lg p-3 font-mono text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 resize-y mb-2"
                      placeholder="Paste the original cleartext here to verify it matches..."
                      value={manualCleartext}
                      onChange={(e) => setManualCleartext(e.target.value)}
                    />
                    <button
                      onClick={() => handleVerify(input, manualCleartext)}
                      disabled={verifying || !manualCleartext.trim()}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      Verify with cleartext
                    </button>
                  </div>
                ) : (
                  <Field label="Cleartext" value={result.cleartext} />
                )}
                <Field
                  label="Device ID"
                  value={result.deviceId}
                  mono
                />
                <Field
                  label="Face ID Verified"
                  value={
                    result.faceIdVerified === undefined
                      ? "N/A (older attestation)"
                      : result.faceIdVerified
                        ? "Yes — device owner confirmed"
                        : "No — not verified"
                  }
                />
                <Field
                  label="Timestamp"
                  value={
                    result.timestamp
                      ? formatTimestamp(result.timestamp)
                      : undefined
                  }
                />
                {/* Public Key Fingerprint with known key support */}
                {result.publicKeyFingerprint && (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Public Key Fingerprint
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-200 text-sm font-mono break-all">
                        {result.publicKeyFingerprint}
                      </span>
                      {result.publicKey && knownKeyName ? (
                        <span className="inline-flex items-center gap-1 text-sm text-green-400 font-medium">
                          Known as: {knownKeyName}
                          <button
                            onClick={() => {
                              removeKnownKey(result.publicKey!);
                              setKnownKeyName(undefined);
                              setKnownKeyVersion((v) => v + 1);
                            }}
                            className="text-gray-500 hover:text-red-400 text-xs ml-1"
                            title="Remove known key"
                          >
                            x
                          </button>
                        </span>
                      ) : result.publicKey && !savingKeyName ? (
                        <button
                          onClick={() => setSavingKeyName(true)}
                          className="text-xs text-gray-500 hover:text-blue-400 transition-colors"
                        >
                          Save as known
                        </button>
                      ) : null}
                    </div>
                    {savingKeyName && result.publicKey && (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="text"
                          className="bg-[#0a0a0a] border border-gray-700 rounded px-2 py-1 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
                          placeholder="Enter a name..."
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
                {result.publicKey && (
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">
                      Registered Identity
                    </div>
                    <div
                      className={`text-sm font-medium ${
                        keyRecord
                          ? "text-green-400"
                          : keyRecord === null
                            ? "text-yellow-400"
                            : "text-gray-500"
                      }`}
                    >
                      {keyRecord
                        ? `Registered to: ${keyRecord.name}`
                        : keyRecord === null
                          ? "Unregistered key"
                          : "Looking up key..."}
                    </div>
                  </div>
                )}
                <Field
                  label="Biometrics Hash"
                  value={result.keystrokeBiometricsHash || "N/A"}
                  mono
                />
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
            What does this prove?
          </h2>
          <div className="space-y-3 text-sm text-gray-400">
            <div>
              <h3 className="text-gray-300 font-medium mb-1">
                It proves:
              </h3>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>
                  The text was typed on a specific device with the given device
                  ID
                </li>
                <li>
                  The text has not been modified since it was signed
                </li>
                <li>
                  The signing key corresponds to the displayed fingerprint
                </li>
                <li>
                  The attestation was created at the indicated timestamp
                </li>
                <li>
                  The server never has access to the cleartext — only the
                  encrypted form is stored
                </li>
              </ul>
            </div>
            <div>
              <h3 className="text-gray-300 font-medium mb-1">
                It does not prove:
              </h3>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>The identity of the person who typed the text</li>
                <li>
                  That the device has not been compromised
                </li>
                <li>
                  That the text was typed voluntarily
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-gray-600 text-xs py-6 border-t border-gray-800 space-y-2">
          <div>
            All verification is performed client-side in your browser. No
            attestation data is sent to any server.
          </div>
          <div>
            <a href="/how" className="text-gray-500 hover:text-gray-300 transition-colors">
              How does KeyWitness work?
            </a>
          </div>
        </footer>
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
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-3">
        Keystroke Timeline ({Math.round(totalDuration).toLocaleString()}ms
        total)
      </div>
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
                {hasBiometrics && timing.force !== undefined && (
                  <span className="text-gray-600 ml-2">
                    f:{timing.force.toFixed(2)} r:{timing.radius?.toFixed(1)}
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      {hasBiometrics && (
        <div className="mt-4 border-t border-gray-800 pt-3">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">
            Touch Biometrics
          </div>
          <div className="flex flex-wrap gap-1">
            {timings.map((t, i) => {
              const displayKey = t.key === " " ? "\u2423" : t.key;
              // Use radius for opacity (varies with finger contact area), fallback to force
              const maxRadius = Math.max(...timings.map((tt) => tt.radius ?? 0), 1);
              const radiusNorm = (t.radius ?? 0) / maxRadius;
              const opacity = Math.max(0.25, radiusNorm);
              // Offset dot within tile based on x/y position on key (normalized to ~0-40px key area)
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
                  title={`x:${t.x?.toFixed(1)} y:${t.y?.toFixed(1)} force:${t.force?.toFixed(3)} radius:${t.radius?.toFixed(1)}`}
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
          <p className="text-[10px] text-gray-600 mt-1">
            Dot = touch position on key. Opacity = contact radius. Hover for details.
          </p>
        </div>
      )}
    </div>
  );
}
