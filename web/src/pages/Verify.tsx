import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { verifyAttestation, VerificationResult, KeystrokeTiming, ProofVerificationResult, TrustStatus } from "../lib/verify";
import Nav from "../components/Nav";

// ── Cleartext attribution helpers ───────────────────────────────────────────

/**
 * Given the cleartext and keystroke timings, determine which characters in the
 * cleartext were actually typed on the KeyWitness keyboard. Returns an array of
 * { char, attested } for each character in the cleartext.
 *
 * Comparison is alphanumeric-only and case-insensitive: non-alphanumeric chars
 * (punctuation, emoji, etc.) are treated as "neutral" (attested by default since
 * they aren't distinguishable). Alphanumeric chars are matched in order against
 * the typed sequence from keystroke events.
 */
function attributeCleartext(
  cleartext: string,
  timings: KeystrokeTiming[] | undefined
): { char: string; attested: boolean }[] {
  if (!timings || timings.length === 0) {
    // No keystroke data — can't attribute anything
    return [...cleartext].map((char) => ({ char, attested: false }));
  }

  // Build the typed alphanumeric sequence from keystroke events
  const typedAlpha: string[] = [];
  for (const t of timings) {
    const k = t.key === "space" ? " " : t.key;
    // Only track alphanumeric chars for matching
    if (/[a-zA-Z0-9]/.test(k)) {
      typedAlpha.push(k.toLowerCase());
    }
  }

  // Walk through cleartext and match alphanumeric chars against typed sequence
  let typedIdx = 0;
  return [...cleartext].map((char) => {
    if (!/[a-zA-Z0-9]/.test(char)) {
      // Non-alphanumeric: neutral (shown normally)
      return { char, attested: true };
    }
    if (typedIdx < typedAlpha.length && char.toLowerCase() === typedAlpha[typedIdx]) {
      typedIdx++;
      return { char, attested: true };
    }
    // Alphanumeric but not in typed sequence — not attested
    return { char, attested: false };
  });
}

// ── Cleartext with attribution component ────────────────────────────────────

function CleartextWithAttribution({ cleartext, timings, encrypted }: {
  cleartext: string;
  timings: KeystrokeTiming[] | undefined;
  encrypted?: boolean;
}) {
  const attribution = attributeCleartext(cleartext, timings);
  const hasUnattested = attribution.some((a) => !a.attested);
  const attestedCount = attribution.filter((a) => a.attested && /[a-zA-Z0-9]/.test(a.char)).length;
  const totalAlpha = attribution.filter((a) => /[a-zA-Z0-9]/.test(a.char)).length;

  return (
    <div>
      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
        What they wrote
        {encrypted && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 font-medium uppercase">
            Decrypted
          </span>
        )}
        {hasUnattested && totalAlpha > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 font-medium">
            {attestedCount}/{totalAlpha} characters verified
          </span>
        )}
      </div>
      <div className="text-base leading-relaxed bg-black/30 rounded-lg p-4 break-all">
        {attribution.map((a, i) => (
          <span
            key={i}
            className={a.attested ? "text-gray-200" : "text-red-400/70"}
            title={a.attested ? undefined : "Not typed on KeyWitness keyboard"}
          >
            {a.char}
          </span>
        ))}
      </div>
      {hasUnattested && (
        <div className="text-xs text-gray-600 mt-1.5 flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-red-400/70" />
          Not typed on KeyWitness keyboard
        </div>
      )}
    </div>
  );
}

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
  const [trustStatus, setTrustStatus] = useState<TrustStatus | null>(null);

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
      setTrustStatus(null);
      try {
        const res = await verifyAttestation(text, encryptionKey, manualText);
        setResult(res);
        if (res.publicKey) {
          const known = getKnownKey(res.publicKey);
          setKnownKeyName(known?.name);
        }
        // Fetch trust status in the background
        if (res.publicKey || res.appVersion) {
          const params = new URLSearchParams();
          if (res.publicKey) params.set("publicKey", res.publicKey);
          if (res.appVersion) params.set("appVersion", res.appVersion);
          try {
            const trustResp = await fetch(`/api/trust/status?${params.toString()}`);
            if (trustResp.ok) {
              const trust = await trustResp.json();
              setTrustStatus(trust);
              res.trustStatus = trust;
            }
          } catch {
            // Trust check is best-effort; don't block verification
          }
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

  const writerName = keyRecord ? keyRecord.name : knownKeyName;
  const hasDeviceVerification = !!attestationDoc?.deviceVerified;
  const hasFaceId = !!attestationDoc?.biometricSignature;
  const hasKeystrokeData = !!(result?.keystrokeTimings && result.keystrokeTimings.length > 0);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-12">

        {/* ── No result yet: show landing ── */}
        {!result && !verifying && (
          <div className="text-center py-20">
            <h1 className="text-4xl font-bold tracking-tight text-white mb-3">
              Was this written by a real person?
            </h1>
            <p className="text-gray-400 text-lg mb-2">
              Paste a KeyWitness attestation below to find out.
            </p>
          </div>
        )}

        {/* ── Loading state ── */}
        {verifying && !result && (
          <div className="text-center py-20">
            <div className="text-gray-400 text-lg">Checking...</div>
          </div>
        )}

        {/* ── Results ── */}
        {result && (
          <div className="mb-12">
            {/* Hero: Who wrote what */}
            <div className={`rounded-xl p-6 mb-6 ${
              status === "verified"
                ? "bg-green-950/30 border border-green-900/40"
                : status === "invalid"
                  ? "bg-red-950/30 border border-red-900/40"
                  : "bg-yellow-950/30 border border-yellow-900/40"
            }`}>
              {/* Status */}
              <div className="flex items-center gap-3 mb-4">
                <span className={`inline-flex items-center justify-center w-10 h-10 rounded-full text-lg font-bold ${
                  status === "verified"
                    ? "bg-green-500/20 text-green-400"
                    : status === "invalid"
                      ? "bg-red-500/20 text-red-400"
                      : "bg-yellow-500/20 text-yellow-400"
                }`}>
                  {status === "verified" ? "\u2713" : status === "invalid" ? "!" : "?"}
                </span>
                <div>
                  <div className={`text-xl font-bold ${
                    status === "verified" ? "text-green-400"
                      : status === "invalid" ? "text-red-400"
                        : "text-yellow-400"
                  }`}>
                    {status === "verified" ? "Typed by a human" : status === "invalid" ? "Suspicious" : "Error"}
                  </div>
                  <div className="text-gray-500 text-sm">
                    {status === "verified"
                      ? "This was typed on a real device and hasn't been changed."
                      : status === "invalid"
                        ? "Something doesn't add up. This may have been altered or faked."
                        : ""}
                  </div>
                </div>
                {result.version && (
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono">
                    {result.version}
                  </span>
                )}
              </div>

              {/* Writer + Message */}
              {!isError && (
                <div className="space-y-4">
                  {/* Who */}
                  {result.publicKey && (
                    <div>
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Who</div>
                      <div className="text-white text-lg font-semibold">
                        {writerName || (keyRecord === null ? "Unknown person" : "Looking up...")}
                      </div>
                      {result.timestamp && (
                        <div className="text-gray-500 text-sm mt-0.5">
                          {formatTimestamp(result.timestamp)}
                        </div>
                      )}
                    </div>
                  )}

                  {/* What they wrote */}
                  {result.cleartext ? (
                    <CleartextWithAttribution cleartext={result.cleartext} timings={result.keystrokeTimings} encrypted={result.encrypted} />
                  ) : result.encrypted && !result.cleartext ? (
                    <div>
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                        What they wrote
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/50 text-blue-400 font-medium uppercase">
                          Locked
                        </span>
                      </div>
                      <div className="text-gray-500 text-sm italic mb-3">
                        {result.decryptionFailed
                          ? "Couldn't unlock the message. The link may be incomplete."
                          : "This message is encrypted. Open the full link from the sender, or paste the text below."}
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
                  ) : null}
                </div>
              )}

              {/* Error */}
              {result.error && (
                <p className="text-red-400 text-sm mt-3">{result.error}</p>
              )}
            </div>

            {/* Trust warnings */}
            {trustStatus && (trustStatus.keyRevoked || trustStatus.credentialRevoked || trustStatus.appVersionTrusted === false) && (
              <div className="rounded-lg px-5 py-3 bg-orange-950/50 border border-orange-900/50 mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-orange-400" />
                  <span className="text-orange-400 text-xs font-semibold uppercase tracking-wide">Trust Warning</span>
                </div>
                <div className="space-y-1 text-sm text-orange-300">
                  {trustStatus.keyRevoked && (
                    <p>Signing key has been revoked{trustStatus.keyRevocationReason ? `: ${trustStatus.keyRevocationReason}` : "."}</p>
                  )}
                  {trustStatus.credentialRevoked && (
                    <p>Device credential has been revoked{trustStatus.credentialRevocationReason ? `: ${trustStatus.credentialRevocationReason}` : "."}</p>
                  )}
                  {trustStatus.appVersionTrusted === false && (
                    <p>App version is no longer trusted{trustStatus.appVersionRevocationReason ? `: ${trustStatus.appVersionRevocationReason}` : "."}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Verified / Not Verified columns ── */}
            {!isError && status === "verified" && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Verified */}
                <div className="rounded-lg border border-green-900/40 bg-[#111111] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center text-xs font-bold">{"\u2713"}</span>
                    <span className="text-green-400 text-sm font-semibold uppercase tracking-wide">Verified</span>
                  </div>
                  <ul className="space-y-2 text-sm">
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-0.5">{"\u2713"}</span>
                      <span className="text-gray-300">Message hasn't been tampered with</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-400 mt-0.5">{"\u2713"}</span>
                      <span className="text-gray-300">Typed by a person (not copy-pasted)</span>
                    </li>
                    {hasDeviceVerification && (
                      <li className="flex items-start gap-2">
                        <span className="text-green-400 mt-0.5">{"\u2713"}</span>
                        <span className="text-gray-300">Real Apple device confirmed</span>
                      </li>
                    )}
                    {hasFaceId && (
                      <li className="flex items-start gap-2">
                        <span className="text-green-400 mt-0.5">{"\u2713"}</span>
                        <span className="text-gray-300">
                          Face ID confirmed by sender
                          {attestationDoc?.biometricTimestamp && (
                            <span className="text-gray-600"> ({Math.round((attestationDoc.biometricTimestamp - attestationDoc.createdAt) / 1000)}s after typing)</span>
                          )}
                        </span>
                      </li>
                    )}
                    {writerName && (
                      <li className="flex items-start gap-2">
                        <span className="text-green-400 mt-0.5">{"\u2713"}</span>
                        <span className="text-gray-300">Registered as "{writerName}"</span>
                      </li>
                    )}
                  </ul>
                </div>

                {/* Not Verified */}
                <div className="rounded-lg border border-gray-800 bg-[#111111] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-5 h-5 rounded-full bg-gray-700 text-gray-400 flex items-center justify-center text-xs font-bold">–</span>
                    <span className="text-gray-400 text-sm font-semibold uppercase tracking-wide">Not verified</span>
                  </div>
                  <ul className="space-y-2 text-sm">
                    {!hasDeviceVerification && (
                      <li className="flex items-start gap-2">
                        <span className="text-gray-600 mt-0.5">–</span>
                        <span className="text-gray-500">Device not confirmed as a real iPhone</span>
                      </li>
                    )}
                    {!hasFaceId && (
                      <li className="flex items-start gap-2">
                        <span className="text-gray-600 mt-0.5">–</span>
                        <span className="text-gray-500">Face ID not confirmed</span>
                      </li>
                    )}
                    {!writerName && (
                      <li className="flex items-start gap-2">
                        <span className="text-gray-600 mt-0.5">–</span>
                        <span className="text-gray-500">Sender hasn't registered their name</span>
                      </li>
                    )}
                    <li className="flex items-start gap-2">
                      <span className="text-gray-600 mt-0.5">–</span>
                      <span className="text-gray-500">Content originality — could be retyped from AI</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-gray-600 mt-0.5">–</span>
                      <span className="text-gray-500">Whether the message was typed voluntarily</span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* ── Details (collapsed) ── */}
            {!isError && (
              <details className="group border border-gray-800 rounded-lg overflow-hidden mb-6">
                <summary className="px-5 py-3 bg-[#111111] cursor-pointer text-sm text-gray-400 hover:text-gray-300 transition-colors flex items-center gap-2">
                  <span className="text-gray-600 group-open:rotate-90 transition-transform">{"\u25B6"}</span>
                  Technical details
                </summary>
                <div className="divide-y divide-gray-800">
                  {/* Device */}
                  <div className="px-5 py-3 bg-[#111111]">
                    <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Device</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-200 text-sm">{result.deviceId}</span>
                      {attestationDoc?.deviceVerified ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/50 text-green-400 font-medium">Real Apple device</span>
                      ) : result?.appAttestPresent ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/50 text-yellow-400 font-medium">Unconfirmed</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-medium">Not verified</span>
                      )}
                    </div>
                  </div>

                  {/* Proof Chain */}
                  {result.proofs && result.proofs.length > 0 && (
                    <ProofChain proofs={result.proofs} />
                  )}

                  {/* Issuer DID */}
                  {result.issuerDID && (
                    <div className="px-5 py-3 bg-[#111111]">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Issuer DID</div>
                      <div className="text-gray-400 text-xs font-mono break-all">{result.issuerDID}</div>
                    </div>
                  )}

                  {/* Signing Key */}
                  {result.publicKeyFingerprint && (
                    <div className="px-5 py-3 bg-[#111111]">
                      <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">Signing Key</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-200 text-sm font-mono break-all">{result.publicKeyFingerprint}</span>
                        {result.publicKey && knownKeyName ? (
                          <span className="inline-flex items-center gap-1 text-sm text-green-400 font-medium">
                            {knownKeyName}
                            <button
                              onClick={() => { removeKnownKey(result.publicKey!); setKnownKeyName(undefined); setKnownKeyVersion((v) => v + 1); }}
                              className="text-gray-500 hover:text-red-400 text-xs ml-1"
                              title="Forget this key"
                            >x</button>
                          </span>
                        ) : result.publicKey && !savingKeyName ? (
                          <button onClick={() => setSavingKeyName(true)} className="text-xs text-gray-500 hover:text-blue-400 transition-colors">
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
                            onClick={() => { if (keyNameInput.trim()) { saveKnownKey(result.publicKey!, keyNameInput.trim()); setKnownKeyName(keyNameInput.trim()); setSavingKeyName(false); setKeyNameInput(""); setKnownKeyVersion((v) => v + 1); }}}
                            disabled={!keyNameInput.trim()}
                            className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                          >Save</button>
                          <button
                            onClick={() => { setSavingKeyName(false); setKeyNameInput(""); }}
                            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
                          >Cancel</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Keystroke Timeline */}
                {hasKeystrokeData && (
                  <KeystrokeTimeline timings={result.keystrokeTimings!} />
                )}
              </details>
            )}
          </div>
        )}

        {/* ── Attestation input (bottom) ── */}
        <div className="border border-gray-800 rounded-lg p-5 mb-10">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            {result ? "Verify another" : "Paste attestation"}
          </h2>
          <textarea
            className="w-full h-32 bg-[#0a0a0a] border border-gray-800 rounded-lg p-4 font-mono text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 resize-y mb-3"
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
          <div className="flex items-center gap-3">
            <button
              onClick={onVerifyClick}
              disabled={verifying || !input.trim()}
              className="px-6 py-2.5 bg-white text-black font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {verifying ? "Checking..." : "Verify"}
            </button>
            <span className="text-gray-600 text-sm">
              Cmd/Ctrl + Enter
            </span>
          </div>
        </div>

        {/* ── How it works ── */}
        <div className="border border-gray-800 rounded-lg p-6 mb-10">
          <h2 className="text-lg font-semibold text-white mb-4">
            How does this work?
          </h2>
          <div className="space-y-3 text-sm text-gray-400">
            <p>
              KeyWitness is a keyboard for iPhone that seals every message you type with a
              digital signature. When someone receives your message, they can verify here
              that it really came from you and hasn't been edited.
            </p>
            <p>
              Verification happens entirely in your browser. Nothing is sent to any server.
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className="text-center text-gray-600 text-xs py-6 border-t border-gray-800 space-y-2">
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
                  {proof.details.created ? <span>{formatTimestamp(String(proof.details.created))}</span> : null}
                  {proof.details.verifiedBy ? <span> (verified by {String(proof.details.verifiedBy)})</span> : null}
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
