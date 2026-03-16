import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { verifyAttestation, VerificationResult, KeystrokeTiming, ProofVerificationResult, TrustStatus } from "../lib/verify";
import { decodeStegKey } from "../lib/stegkey";
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

  // Replay keystrokes (including backspaces) to get the actual final typed text.
  // This correctly handles cases where the user types "hou", backspaces 3x,
  // then types "you" — the final text is "you" from the last 3 keystrokes.
  const composed: string[] = [];
  for (const t of timings) {
    if (t.key === "backspace") {
      composed.pop();
    } else {
      const k = t.key === "space" ? " " : t.key === "newline" ? "\n" : t.key;
      composed.push(k);
    }
  }

  // Build alphanumeric-only sequence from composed text for matching
  const composedAlpha: string[] = [];
  for (const ch of composed) {
    if (/[a-zA-Z0-9]/.test(ch)) {
      composedAlpha.push(ch.toLowerCase());
    }
  }

  // Walk through cleartext and match alphanumeric chars against composed sequence
  let typedIdx = 0;
  return [...cleartext].map((char) => {
    if (!/[a-zA-Z0-9]/.test(char)) {
      // Non-alphanumeric: neutral (shown normally)
      return { char, attested: true };
    }
    if (typedIdx < composedAlpha.length && char.toLowerCase() === composedAlpha[typedIdx]) {
      typedIdx++;
      return { char, attested: true };
    }
    // Alphanumeric but not in typed sequence — not attested
    return { char, attested: false };
  });
}

// ── Cleartext with attribution component ────────────────────────────────────

function CleartextWithAttribution({ cleartext, timings, isVoice }: {
  cleartext: string;
  timings: KeystrokeTiming[] | undefined;
  encrypted?: boolean;
  isVoice?: boolean;
}) {
  // Voice attestations: all text is attested (it's the transcription itself)
  if (isVoice) {
    return (
      <div>
        <div className="text-xl leading-relaxed break-words text-green-400">
          {cleartext}
        </div>
        <div className="text-[11px] text-gray-600 mt-2 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400" />
          Transcribed from verified voice input
        </div>
      </div>
    );
  }

  // No keystroke timings — show text in neutral color (public attestation without encryption key)
  if (!timings || timings.length === 0) {
    return (
      <div>
        <div className="text-xl leading-relaxed break-words text-white">
          {cleartext}
        </div>
        <div className="text-[11px] text-gray-600 mt-2 flex items-center gap-1.5">
          Keystroke attribution requires the encryption key
        </div>
      </div>
    );
  }

  const attribution = attributeCleartext(cleartext, timings);
  const hasUnattested = attribution.some((a) => !a.attested);

  return (
    <div>
      <div className="text-xl leading-relaxed break-words">
        {attribution.map((a, i) => (
          <span
            key={i}
            className={a.attested ? "text-white" : "text-red-400/60"}
            title={a.attested ? undefined : "Not typed on KeyWitness keyboard"}
          >
            {a.char}
          </span>
        ))}
      </div>
      {hasUnattested && (
        <div className="text-[11px] text-gray-600 mt-2 flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400/60" />
          Red text was not typed on KeyWitness keyboard
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

// ── Text normalization for hash comparison ───────────────────────────────────

const SEAL_URL_RE = /\s*(?:https?:\/\/)?(?:typed\.by\/[A-Za-z0-9_-]+\/\d+|keywitness\.io\/v\/[A-Za-z0-9]+)(?:#[^\s]*)?\s*$/;

/** Strip a KeyWitness/typed.by seal link and trailing whitespace from pasted text. */
function normalizePastedText(text: string): string {
  return text.replace(SEAL_URL_RE, "");
}

async function sha256Base64url(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Known keys localStorage helpers ─────────────────────────────────────────

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

function formatTimestampShort(iso: string): string {
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

function proofTypeLabel(proofType: string): string {
  switch (proofType) {
    case "keystrokeAttestation": return "Keystroke Attestation";
    case "voiceAttestation": return "Voice Attestation";
    case "photoAttestation": return "Photo Attestation";
    case "biometricVerification": return "Face ID Verification";
    case "deviceAttestation": return "Device Attestation";
    case "fingerprintVerification": return "Fingerprint Verification";
    case "hardwareAttestation": return "Hardware Attestation";
    default: return proofType;
  }
}

export default function Verify({ shortId, username, usernameSeq }: { shortId?: string; username?: string; usernameSeq?: number }) {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [manualCleartext, setManualCleartext] = useState("");
  const [knownKeyName, setKnownKeyName] = useState<string | undefined>(undefined);
  const [savingKeyName, setSavingKeyName] = useState(false);
  const [keyNameInput, setKeyNameInput] = useState("");
  const [, setKnownKeyVersion] = useState(0);
  const [trustStatus, setTrustStatus] = useState<TrustStatus | null>(null);
  const [resolvedShortId, setResolvedShortId] = useState<string | undefined>(undefined);
  const [serverDeviceVerified, setServerDeviceVerified] = useState<boolean | undefined>(undefined);
  const [madePublic, setMadePublic] = useState<boolean | null>(null);
  const [makingPublic, setMakingPublic] = useState(false);

  // Resolve typed.by vanity URL (username/seq) to shortId
  useEffect(() => {
    if (username && usernameSeq) {
      fetch(`/api/resolve?username=${encodeURIComponent(username)}&seq=${usernameSeq}`)
        .then((r) => r.json())
        .then((data) => {
          if (data.shortId) setResolvedShortId(data.shortId);
        })
        .catch(() => {});
    }
  }, [username, usernameSeq]);

  // Try to extract the encryption key from the URL fragment.
  // It may be a plain base64url key, emoji encoding, or old zero-width encoding.
  // Some browsers percent-encode emoji in hash fragments, so decode first.
  const urlEncryptionKey = (() => {
    const rawFragment = window.location.hash.slice(1);
    if (!rawFragment) return undefined;
    // Percent-decode in case browser encoded the emoji
    let fragment: string;
    try {
      fragment = decodeURIComponent(rawFragment);
    } catch {
      fragment = rawFragment;
    }
    // Try emoji/steg decode first
    const steg = decodeStegKey(fragment);
    if (steg) return steg;
    // Otherwise treat as plain base64url key
    return fragment;
  })();
  const [hashMatchResult, setHashMatchResult] = useState<"match" | "mismatch" | null>(null);

  const params = new URLSearchParams(window.location.search);
  const queryId = params.get("a") || shortId || resolvedShortId;

  const attestationDoc = useQuery(
    api.attestations.getByShortId,
    queryId ? { shortId: queryId } : "skip",
  );

  // Use URL key first, fall back to DB-stored public key
  const encryptionKey = urlEncryptionKey || attestationDoc?.publicEncryptionKey || undefined;

  const keyRecord = useQuery(
    api.keys.getByPublicKey,
    result?.publicKey ? { publicKey: result.publicKey } : "skip",
  );

  const handleVerify = useCallback(
    async (text: string, manualText?: string) => {
      if (!text.trim()) return;
      setVerifying(true);
      setTrustStatus(null);
      setServerDeviceVerified(undefined);
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
        // Upload to server for device verification (App Attest requires server-side P-256)
        if (res.valid) {
          try {
            const resp = await fetch("/api/attestations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ attestation: text }),
            });
            if (resp.ok) {
              const serverData = await resp.json();
              setServerDeviceVerified(serverData.deviceVerified ?? false);
            }
          } catch {
            // Server verification is best-effort
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
      // If attestation is in file storage, fetch it first
      if (attestationDoc.attestationUrl && !attestationDoc.attestation) {
        fetch(attestationDoc.attestationUrl)
          .then((r) => r.text())
          .then((text) => {
            setInput(text);
            handleVerify(text);
          })
          .catch(() => {});
      } else {
        setInput(attestationDoc.attestation);
        handleVerify(attestationDoc.attestation);
      }
    }
    if (attestationDoc?.publicEncryptionKey) {
      setMadePublic(true);
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
  // Use DB-verified status when available, fall back to VC claims for pasted attestations
  const hasDeviceVerification = !!attestationDoc?.deviceVerified || !!serverDeviceVerified || !!result?.appAttestPresent;
  const hasFaceId = !!attestationDoc?.biometricSignature || !!result?.faceIdVerified;
  const hasKeystrokeData = !!(result?.keystrokeTimings && result.keystrokeTimings.length > 0);
  // Even without decrypted timings, keystroke proof is present if the VC has keystroke data
  const hasKeystrokeProof = hasKeystrokeData
    || !!(result?.proofs?.some((p) => p.proofType === "keystrokeAttestation" && p.valid));
  const isVoice = result?.attestationType === "spoken";
  const isPhoto = result?.attestationType === "photo";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-12">

        {/* ── No result yet: show landing ── */}
        {!result && !verifying && (
          <div className="py-20">
            <div className="text-center mb-8">
              <h1 className="text-4xl font-bold tracking-tight text-white mb-3">
                Was this written by a real person?
              </h1>
              <p className="text-gray-400 text-lg">
                Paste a KeyWitness attestation below to find out.
              </p>
            </div>
            <textarea
              className="w-full h-32 bg-[#111] border border-gray-800 rounded-xl p-4 font-mono text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 resize-y mb-3"
              placeholder="-----BEGIN KEYWITNESS ATTESTATION-----&#10;...&#10;-----END KEYWITNESS ATTESTATION-----"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onVerifyClick();
                }
              }}
            />
            <div className="flex justify-end">
              <button
                onClick={onVerifyClick}
                disabled={verifying || !input.trim()}
                className="px-5 py-2 bg-white text-black text-sm font-semibold rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Verify
              </button>
            </div>
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

            {/* ── Error / Invalid state ── */}
            {(isError || status === "invalid") && (
              <div className={`rounded-2xl p-8 mb-6 ${
                status === "invalid"
                  ? "bg-red-950/20 border border-red-900/30"
                  : "bg-yellow-950/20 border border-yellow-900/30"
              }`}>
                <div className={`text-xl font-bold mb-2 ${status === "invalid" ? "text-red-400" : "text-yellow-400"}`}>
                  {status === "invalid" ? "Verification failed" : "Error"}
                </div>
                <div className="text-gray-500 text-sm">
                  {status === "invalid"
                    ? "This attestation could not be verified. It may have been altered."
                    : ""}
                </div>
                {result.error && (
                  <p className="text-red-400/80 text-sm mt-2 font-mono">{result.error}</p>
                )}
              </div>
            )}

            {/* ── Verified ── */}
            {!isError && status === "verified" && (
              <div className="space-y-6">

                {/* The message card */}
                <div className="relative rounded-2xl overflow-hidden border border-gray-800/40" style={{ background: "linear-gradient(160deg, #141416 0%, #111113 60%, #0f1218 100%)" }}>

                  {/* Message content */}
                  <div className="px-8 pt-8 pb-6 sm:px-10 sm:pt-10 sm:pb-8">
                    {isPhoto ? (
                      <div>
                        {result.cleartext && result.encrypted ? (
                          (() => {
                            // Decrypt and display photo from encrypted payload
                            try {
                              const inner = JSON.parse(atob(result.cleartext.replace(/-/g, "+").replace(/_/g, "/")));
                              if (inner.imageBase64) {
                                const imgBytes = atob(inner.imageBase64.replace(/-/g, "+").replace(/_/g, "/"));
                                const arr = new Uint8Array(imgBytes.length);
                                for (let i = 0; i < imgBytes.length; i++) arr[i] = imgBytes.charCodeAt(i);
                                const blob = new Blob([arr], { type: "image/jpeg" });
                                const url = URL.createObjectURL(blob);
                                return <img src={url} alt="Attested photo" className="w-full rounded-lg" />;
                              }
                            } catch { /* fall through */ }
                            return null;
                          })()
                        ) : null}
                        <div className="mt-4 text-center">
                          <div className="text-green-400 text-sm font-medium mb-1">Unfiltered Photograph</div>
                          <div className="text-gray-500 text-xs">
                            {result.imageWidth && result.imageHeight ? `${result.imageWidth}×${result.imageHeight}` : ""}
                            {result.imageSizeBytes ? ` · ${(result.imageSizeBytes / 1024).toFixed(0)} KB` : ""}
                            {result.imageFormat ? ` · ${result.imageFormat.toUpperCase()}` : ""}
                          </div>
                          {!result.cleartext && result.encrypted && (
                            <div className="text-gray-600 text-xs mt-2">Photo encrypted — add decryption key to URL fragment to view</div>
                          )}
                        </div>
                      </div>
                    ) : result.cleartext ? (
                      <div className="relative pl-6">
                        {/* Decorative quote accent — thin green bar */}
                        <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-green-500/25" />
                        <blockquote className="text-[22px] sm:text-[26px] leading-[1.45] text-white font-light tracking-[-0.01em]">
                          <CleartextWithAttribution cleartext={result.cleartext} timings={result.keystrokeTimings} encrypted={result.encrypted} isVoice={isVoice} />
                        </blockquote>
                        {queryId && encryptionKey && result.encrypted && madePublic === null && (
                          <button
                            onClick={async () => {
                              setMakingPublic(true);
                              try {
                                const resp = await fetch("/api/attestations/make-public", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ shortId: queryId, encryptionKey }),
                                });
                                if (resp.ok) {
                                  setMadePublic(true);
                                }
                              } finally {
                                setMakingPublic(false);
                              }
                            }}
                            disabled={makingPublic}
                            className="mt-3 text-xs px-3 py-1.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors"
                          >
                            {makingPublic ? "Saving..." : "Make public — anyone can read without the key"}
                          </button>
                        )}
                        {madePublic && result.encrypted && (
                          <div className="mt-2 text-xs text-gray-500">This message is public — readable without the encryption key.</div>
                        )}
                      </div>
                    ) : result.encrypted && !result.cleartext ? (
                      <div>
                        {result.cleartextLength ? (
                          <div className="text-2xl text-white font-light mb-4">
                            {result.cleartextLength} characters were {isVoice ? "spoken" : "typed"}
                          </div>
                        ) : null}
                        <div className="text-gray-500 text-sm mb-3">
                          Paste the message you received to verify it matches exactly.
                        </div>
                        <textarea
                          className="w-full h-24 bg-[#0a0a0a] border border-gray-700 rounded-lg p-3 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 focus:ring-1 focus:ring-gray-600 resize-y mb-2"
                          placeholder="Paste the text here..."
                          value={manualCleartext}
                          onChange={(e) => {
                            setManualCleartext(e.target.value);
                            setHashMatchResult(null);
                          }}
                        />
                        {hashMatchResult === "match" ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-green-400 text-sm font-medium">
                              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                                <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Text matches — this is exactly what was typed
                            </div>
                            {queryId && encryptionKey && madePublic === null && (
                              <button
                                onClick={async () => {
                                  setMakingPublic(true);
                                  try {
                                    const resp = await fetch("/api/attestations/make-public", {
                                      method: "POST",
                                      headers: { "Content-Type": "application/json" },
                                      body: JSON.stringify({ shortId: queryId, encryptionKey }),
                                    });
                                    if (resp.ok) {
                                      setMadePublic(true);
                                    }
                                  } finally {
                                    setMakingPublic(false);
                                  }
                                }}
                                disabled={makingPublic}
                                className="text-xs px-3 py-1.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-500 disabled:opacity-40 transition-colors"
                              >
                                {makingPublic ? "Saving..." : "Make public — anyone can read without the key"}
                              </button>
                            )}
                            {madePublic && (
                              <div className="text-xs text-gray-500">This message is public — readable without the encryption key.</div>
                            )}
                          </div>
                        ) : hashMatchResult === "mismatch" ? (
                          <div className="text-red-400 text-sm">
                            {"\u2717"} Text does not match the sealed message
                          </div>
                        ) : (
                          <button
                            onClick={async () => {
                              const normalized = normalizePastedText(manualCleartext);
                              const hash = await sha256Base64url(normalized);
                              if (hash === result.cleartextHash) {
                                setHashMatchResult("match");
                              } else {
                                // Trailing space can be lost during copy-paste
                                const alt = normalized.endsWith(" ") ? normalized.slice(0, -1) : normalized + " ";
                                const altHash = await sha256Base64url(alt);
                                setHashMatchResult(altHash === result.cleartextHash ? "match" : "mismatch");
                              }
                            }}
                            disabled={!manualCleartext.trim()}
                            className="px-4 py-1.5 bg-white text-black text-sm font-medium rounded-lg hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            Verify match
                          </button>
                        )}
                      </div>
                    ) : null}

                    {/* Signature */}
                    <div className="mt-6 pl-6 flex items-center gap-2">
                      <span className="text-gray-600">{"\u2014"}</span>
                      <span className="text-white font-semibold text-[17px] italic tracking-tight">
                        {writerName || (keyRecord === null ? "Someone" : "...")}
                      </span>
                      <span className="inline-flex items-center gap-1 text-green-400 text-xs font-semibold bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/15">
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                        </svg>
                        human
                      </span>
                      <span className="text-gray-600 text-xs ml-2">
                        {hasDeviceVerification && <>iPhone</>}
                        {hasDeviceVerification && result.timestamp && <>{" · "}</>}
                        {result.timestamp && <>{formatTimestampShort(result.timestamp)}</>}
                      </span>
                    </div>
                  </div>

                  {/* Verification strip — quiet, secondary */}
                  <div className="px-8 sm:px-10 py-2.5 border-t border-gray-800/40 flex items-center gap-4 text-[11px] text-gray-600">
                    <span className="text-green-500/70 flex items-center gap-1">
                      <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                      </svg>
                      Verified
                    </span>
                    <span className={(hasKeystrokeProof || isVoice || isPhoto) ? "text-green-500/50" : ""}>
                      {(hasKeystrokeProof || isVoice || isPhoto) ? "\u2713" : "\u2013"} {isPhoto ? "Camera Capture" : isVoice ? "Voice" : "Keystrokes"}
                    </span>
                    <span className={hasDeviceVerification ? "text-green-500/50" : ""}>
                      {hasDeviceVerification ? "\u2713" : "\u2013"} Device
                    </span>
                    <span className={hasFaceId ? "text-green-500/50" : ""}>
                      {hasFaceId ? "\u2713" : "\u2013"} Face ID
                      {hasFaceId && attestationDoc?.biometricTimestamp && (
                        <span className="ml-0.5">{Math.round((attestationDoc.biometricTimestamp - attestationDoc.createdAt) / 1000)}s</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* What this means — plain English */}
                <div className="rounded-xl bg-[#111111] border border-gray-800/60 p-6 space-y-3 text-sm text-gray-400">
                  <div className="text-white font-semibold text-base mb-2">What this means</div>
                  {isPhoto && (
                    <p>
                      <span className="text-green-400 font-medium">Photo verified</span> — this photo was taken directly by the phone's camera and has not been edited, filtered, or modified.
                      {result.imageWidth && result.imageHeight && (
                        <> Original resolution: {result.imageWidth}×{result.imageHeight}.</>
                      )}
                      {" "}The image was hashed at capture time before any processing could occur.
                    </p>
                  )}
                  {isVoice && (
                    <p>
                      <span className="text-green-400 font-medium">Voice verified</span> — this text was spoken aloud into the phone's microphone.
                      {result?.audioMeshCorrelationScore !== undefined && (
                        <> The speaker's face movements correlated {Math.round(result.audioMeshCorrelationScore * 100)}% with the audio, confirming a real person spoke these words.</>
                      )}
                    </p>
                  )}
                  {hasKeystrokeProof && !isVoice && !isPhoto && (
                    <p>
                      <span className="text-green-400 font-medium">Keystrokes verified</span> — this text was typed by hand on a keyboard, not pasted or generated. The typing rhythm and finger positions are recorded in the seal.
                    </p>
                  )}
                  {hasDeviceVerification && (
                    <p>
                      <span className="text-green-400 font-medium">Device verified</span> — Apple confirmed this came from a real, unmodified iPhone running the genuine KeyWitness app.
                    </p>
                  )}
                  {hasFaceId && (
                    <p>
                      <span className="text-green-400 font-medium">Face ID confirmed</span> — the person whose face unlocks this phone saw the message and approved it
                      {attestationDoc?.biometricTimestamp ? ` ${Math.round((attestationDoc.biometricTimestamp - attestationDoc.createdAt) / 1000)} seconds after typing` : ""}.
                    </p>
                  )}
                  {!hasKeystrokeProof && !isVoice && !isPhoto && !hasDeviceVerification && !hasFaceId && (
                    <p>The cryptographic signature is valid — the text hasn't been modified since it was signed.</p>
                  )}
                </div>

                {/* What this doesn't mean */}
                <details className="group rounded-xl px-6 py-4 bg-[#111] border border-gray-800">
                  <summary className="text-sm text-gray-400 font-medium cursor-pointer hover:text-gray-300 transition-colors flex items-center gap-1.5">
                    <span className="group-open:rotate-90 transition-transform">{"\u25B6"}</span>
                    What this doesn't mean
                  </summary>
                  <div className="mt-3 space-y-2 text-sm text-gray-500 leading-relaxed">
                    <p><span className="text-gray-400">Not proof of identity</span> — we know which device typed this, not who was holding it (unless Face ID is present).</p>
                    <p><span className="text-gray-400">Not proof of intent</span> — the typist may have been coerced, dictated to, or copying from a script.</p>
                    <p><span className="text-gray-400">Not proof of originality</span> — the text could be a quote, a copy of someone else's words, or a known phrase typed by hand.</p>
                  </div>
                </details>

                {/* Trust warnings */}
                {trustStatus && (trustStatus.keyRevoked || trustStatus.credentialRevoked || trustStatus.appVersionTrusted === false) && (
                  <div className="rounded-xl px-6 py-4 bg-orange-950/30 border border-orange-900/30">
                    <div className="text-orange-400 text-sm font-medium mb-1">Trust warning</div>
                    <div className="space-y-1 text-sm text-orange-300/80">
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

                {/* Technical details */}
                <details className="group">
                  <summary className="text-xs text-gray-600 hover:text-gray-400 cursor-pointer transition-colors flex items-center gap-1.5">
                    <span className="group-open:rotate-90 transition-transform">{"\u25B6"}</span>
                    Technical details
                  </summary>
                  <div className="mt-3 rounded-xl bg-[#111111] border border-gray-800/60 divide-y divide-gray-800/60 text-sm overflow-hidden">
                    {/* Device */}
                    <div className="px-5 py-3">
                      <div className="text-xs text-gray-600 mb-0.5">Device</div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-gray-300 font-mono text-xs">{result.deviceId}</span>
                        {attestationDoc?.deviceVerified ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/40 text-green-400 font-medium">Verified</span>
                        ) : result?.appAttestPresent ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-900/40 text-yellow-400 font-medium">Unconfirmed</span>
                        ) : null}
                      </div>
                    </div>

                    {/* Proof Chain */}
                    {result.proofs && result.proofs.length > 0 && (
                      <ProofChain proofs={result.proofs} serverDeviceVerified={serverDeviceVerified} />
                    )}

                    {/* Issuer DID */}
                    {result.issuerDID && (
                      <div className="px-5 py-3">
                        <div className="text-xs text-gray-600 mb-0.5">Issuer</div>
                        <div className="text-gray-400 text-xs font-mono break-all">{result.issuerDID}</div>
                      </div>
                    )}

                    {/* Signing Key */}
                    {result.publicKeyFingerprint && (
                      <div className="px-5 py-3">
                        <div className="text-xs text-gray-600 mb-0.5">Key</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-gray-300 text-xs font-mono break-all">{result.publicKeyFingerprint}</span>
                          {result.publicKey && knownKeyName ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-400 font-medium">
                              {knownKeyName}
                              <button
                                onClick={() => { removeKnownKey(result.publicKey!); setKnownKeyName(undefined); setKnownKeyVersion((v) => v + 1); }}
                                className="text-gray-600 hover:text-red-400 text-[10px] ml-0.5"
                                title="Forget this key"
                              >{"\u00D7"}</button>
                            </span>
                          ) : result.publicKey && !savingKeyName ? (
                            <button onClick={() => setSavingKeyName(true)} className="text-[10px] text-gray-600 hover:text-blue-400 transition-colors">
                              Remember
                            </button>
                          ) : null}
                        </div>
                        {savingKeyName && result.publicKey && (
                          <div className="flex items-center gap-2 mt-2">
                            <input
                              type="text"
                              className="bg-[#0a0a0a] border border-gray-700 rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600"
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
                              className="text-[10px] px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-40 transition-colors"
                            >Save</button>
                            <button
                              onClick={() => { setSavingKeyName(false); setKeyNameInput(""); }}
                              className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
                            >Cancel</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Keystroke Timeline */}
                    {hasKeystrokeData && (
                      <KeystrokeTimeline timings={result.keystrokeTimings!} />
                    )}

                    {/* Verify another */}
                    <div className="px-5 py-3">
                      <div className="text-xs text-gray-600 mb-1.5">Verify another</div>
                      <textarea
                        className="w-full h-20 bg-[#0a0a0a] border border-gray-800 rounded p-2.5 font-mono text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-gray-600 resize-y mb-2"
                        placeholder="Paste attestation..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            onVerifyClick();
                          }
                        }}
                      />
                      <button
                        onClick={onVerifyClick}
                        disabled={verifying || !input.trim()}
                        className="text-xs px-3 py-1.5 bg-white text-black font-medium rounded hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {verifying ? "Checking..." : "Verify"}
                      </button>
                    </div>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

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

function ProofChain({ proofs, serverDeviceVerified }: { proofs: ProofVerificationResult[]; serverDeviceVerified?: boolean }) {
  return (
    <div className="px-5 py-3">
      <div className="text-xs text-gray-600 mb-1.5">Proofs</div>
      <div className="space-y-1.5">
        {proofs.map((proof, i) => {
          const isDevice = proof.proofType === "deviceAttestation";
          const valid = isDevice ? (serverDeviceVerified || proof.valid) : proof.valid;
          const error = isDevice && serverDeviceVerified ? undefined : proof.error;
          return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className={valid ? "text-green-400" : "text-red-400"}>
              {valid ? "\u2713" : "\u2717"}
            </span>
            <span className={valid ? "text-gray-300" : "text-red-400"}>
              {proofTypeLabel(proof.proofType)}
            </span>
            {isDevice && serverDeviceVerified && (
              <span className="text-green-500/70">(server-verified)</span>
            )}
            {error && (
              <span className="text-red-400/60">{"\u2014"} {error}</span>
            )}
            {proof.details?.verifiedBy ? (
              <span className="text-gray-600">({String(proof.details.verifiedBy)})</span>
            ) : null}
          </div>
          );
        })}
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
            {(() => {
              const xs = timings.map((t) => t.x ?? 0);
              const ys = timings.map((t) => t.y ?? 0);
              const minX = Math.min(...xs), maxX = Math.max(...xs);
              const minY = Math.min(...ys), maxY = Math.max(...ys);
              const rangeX = maxX - minX || 1;
              const rangeY = maxY - minY || 1;
              const maxRadius = Math.max(...timings.map((tt) => tt.radius ?? 0), 1);
              return timings.map((t, i) => {
              const displayKey = t.key === " " ? "\u2423" : t.key;
              const radiusNorm = (t.radius ?? 0) / maxRadius;
              const opacity = Math.max(0.25, radiusNorm);
              const dotX = t.x !== undefined ? 2 + ((t.x - minX) / rangeX) * 20 : 12;
              const dotY = t.y !== undefined ? 2 + ((t.y - minY) / rangeY) * 20 : 12;
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
            });
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
