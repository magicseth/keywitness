import { verifyAttestation, VerificationResult } from "./verify";

// ── DOM references ───────────────────────────────────────────────────────────

const textarea = document.getElementById(
  "attestation-input"
) as HTMLTextAreaElement;
const verifyBtn = document.getElementById("verify-btn") as HTMLButtonElement;
const resultsEl = document.getElementById("results") as HTMLDivElement;
const statusBanner = document.getElementById("status-banner") as HTMLDivElement;
const statusDot = document.getElementById("status-dot") as HTMLSpanElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const resultDetails = document.getElementById(
  "result-details"
) as HTMLDivElement;
const errorContainer = document.getElementById(
  "error-container"
) as HTMLDivElement;
const errorMessage = document.getElementById("error-message") as HTMLDivElement;

// ── Field elements ───────────────────────────────────────────────────────────

const fieldCleartext = document.getElementById(
  "field-cleartext"
) as HTMLDivElement;
const fieldDeviceId = document.getElementById(
  "field-device-id"
) as HTMLDivElement;
const fieldTimestamp = document.getElementById(
  "field-timestamp"
) as HTMLDivElement;
const fieldFingerprint = document.getElementById(
  "field-fingerprint"
) as HTMLDivElement;
const fieldBiometrics = document.getElementById(
  "field-biometrics"
) as HTMLDivElement;

// ── Render result ────────────────────────────────────────────────────────────

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

function renderResult(result: VerificationResult) {
  resultsEl.classList.add("visible");

  // Determine status category
  const isError = !result.valid && !result.cleartext;
  const status = result.valid ? "verified" : isError ? "error" : "invalid";

  // Status banner
  statusBanner.className = `status-banner ${status}`;
  statusDot.className = "status-dot";
  statusText.textContent =
    status === "verified"
      ? "VERIFIED"
      : status === "invalid"
        ? "INVALID"
        : "ERROR";

  if (isError) {
    // Show only error message, hide details
    resultDetails.style.display = "none";
    errorContainer.style.display = "block";
    errorMessage.textContent = result.error || "Unknown error.";
    return;
  }

  // Show details, hide error container
  resultDetails.style.display = "block";
  errorContainer.style.display = result.error ? "block" : "none";
  if (result.error) {
    errorMessage.textContent = result.error;
  }

  // Populate fields
  fieldCleartext.textContent = result.cleartext || "";
  fieldDeviceId.textContent = result.deviceId || "";
  fieldTimestamp.textContent = result.timestamp
    ? formatTimestamp(result.timestamp)
    : "";
  fieldFingerprint.textContent = result.publicKeyFingerprint || "";
  fieldBiometrics.textContent = result.keystrokeBiometricsHash || "N/A";
}

// ── Event handling ───────────────────────────────────────────────────────────

verifyBtn.addEventListener("click", async () => {
  const input = textarea.value.trim();
  if (!input) {
    resultsEl.classList.remove("visible");
    return;
  }

  verifyBtn.disabled = true;
  verifyBtn.textContent = "Verifying...";

  try {
    const result = await verifyAttestation(input);
    renderResult(result);
  } finally {
    verifyBtn.disabled = false;
    verifyBtn.textContent = "Verify";
  }
});

// Allow Cmd/Ctrl+Enter to verify
textarea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    verifyBtn.click();
  }
});

// ── Auto-load attestation from URL parameter ────────────────────────────────

(async () => {
  const params = new URLSearchParams(window.location.search);
  const attestationId = params.get("a");
  if (!attestationId) return;

  try {
    const res = await fetch(`/api/attestations/${encodeURIComponent(attestationId)}`);
    if (!res.ok) return;

    const data = await res.json();
    if (data.attestation) {
      textarea.value = data.attestation;
      verifyBtn.click();
    }
  } catch {
    // Silently ignore fetch errors (e.g. running without the API server)
  }
})();
