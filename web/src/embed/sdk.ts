/**
 * KeyWitness Embed SDK
 *
 * Drop-in verification badges for any website.
 *
 * Usage:
 *   <script src="https://keywitness.io/embed.js"></script>
 *   <div data-keywitness="abc123" data-keywitness-style="inline"></div>
 *
 * Or programmatically:
 *   const badge = KeyWitness.badge('#target', 'abc123', { style: 'card' });
 *   const result = await KeyWitness.verify(attestationBlock);
 */

const ORIGIN = (() => {
  try {
    const s = document.currentScript as HTMLScriptElement | null;
    if (s?.src) return new URL(s.src).origin;
  } catch { /* ignore */ }
  return "https://keywitness.io";
})();

const API = `${ORIGIN}/api`;

// ── Types ────────────────────────────────────────────────────────────────────

interface VerifyResult {
  valid: boolean;
  version?: string;
  deviceId?: string;
  faceIdVerified?: boolean;
  timestamp?: string;
  publicKey?: string;
  publicKeyFingerprint?: string;
  issuerDID?: string;
  appAttestPresent?: boolean;
  appVersion?: string;
  encrypted?: boolean;
  deviceVerified?: boolean;
  biometricVerified?: boolean;
  proofs?: Array<{ proofType: string; valid: boolean; error?: string }>;
  error?: string;
}

interface BadgeOptions {
  style?: "inline" | "card" | "floating";
  theme?: "light" | "dark" | "auto";
  position?: "top-right" | "bottom-right" | "bottom-left" | "top-left";
  onVerified?: (result: VerifyResult) => void;
}

interface BadgeHandle {
  destroy(): void;
  update(shortId: string): void;
}

// ── SDK ──────────────────────────────────────────────────────────────────────

const KeyWitness = {
  version: "1.0.0",

  /**
   * Verify an attestation by its raw PEM block (server-side crypto verification).
   */
  async verify(attestation: string): Promise<VerifyResult> {
    const resp = await fetch(`${API}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attestation }),
    });
    return resp.json();
  },

  /**
   * Verify an attestation by its short ID (looks up from KeyWitness server).
   */
  async verifyById(shortId: string): Promise<VerifyResult> {
    const resp = await fetch(`${API}/verify?id=${encodeURIComponent(shortId)}`);
    return resp.json();
  },

  /**
   * Render a verification badge inside a target element.
   */
  badge(target: HTMLElement | string, shortId: string, options?: BadgeOptions): BadgeHandle {
    const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    if (!el) throw new Error(`KeyWitness: element not found: ${target}`);

    const style = options?.style || "inline";
    const theme = options?.theme || "auto";

    const iframe = document.createElement("iframe");
    iframe.src = `${ORIGIN}/embed/badge?id=${encodeURIComponent(shortId)}&style=${style}&theme=${theme}`;
    iframe.setAttribute("frameborder", "0");
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    iframe.setAttribute("loading", "lazy");
    iframe.setAttribute("title", "KeyWitness Verification Badge");
    iframe.style.border = "none";
    iframe.style.overflow = "hidden";

    if (style === "inline") {
      iframe.style.width = "200px";
      iframe.style.height = "28px";
      iframe.style.display = "inline-block";
      iframe.style.verticalAlign = "middle";
    } else if (style === "card") {
      iframe.style.width = "320px";
      iframe.style.height = "180px";
      iframe.style.borderRadius = "8px";
    } else if (style === "floating") {
      iframe.style.position = "fixed";
      iframe.style.width = "48px";
      iframe.style.height = "48px";
      iframe.style.zIndex = "999999";
      iframe.style.transition = "width 0.2s, height 0.2s";
      const pos = options?.position || "bottom-right";
      if (pos.includes("bottom")) iframe.style.bottom = "16px";
      if (pos.includes("top")) iframe.style.top = "16px";
      if (pos.includes("right")) iframe.style.right = "16px";
      if (pos.includes("left")) iframe.style.left = "16px";
    }

    el.appendChild(iframe);

    const handler = (event: MessageEvent) => {
      if (event.origin !== ORIGIN) return;
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "keywitness:verified" && event.data.shortId === shortId) {
        options?.onVerified?.(event.data.result);
      }
      if (event.data.type === "keywitness:resize") {
        if (event.data.width) iframe.style.width = `${event.data.width}px`;
        if (event.data.height) iframe.style.height = `${event.data.height}px`;
      }
    };
    window.addEventListener("message", handler);

    return {
      destroy() {
        window.removeEventListener("message", handler);
        iframe.remove();
      },
      update(newShortId: string) {
        iframe.src = `${ORIGIN}/embed/badge?id=${encodeURIComponent(newShortId)}&style=${style}&theme=${theme}`;
      },
    };
  },

  /**
   * Auto-render badges for all elements with data-keywitness attribute.
   */
  autoRender() {
    document.querySelectorAll<HTMLElement>("[data-keywitness]").forEach((el) => {
      if (el.getAttribute("data-keywitness-rendered")) return;
      const shortId = el.getAttribute("data-keywitness");
      const style = (el.getAttribute("data-keywitness-style") || "inline") as BadgeOptions["style"];
      const theme = (el.getAttribute("data-keywitness-theme") || "auto") as BadgeOptions["theme"];
      if (shortId) {
        el.setAttribute("data-keywitness-rendered", "true");
        KeyWitness.badge(el, shortId, { style, theme });
      }
    });
  },
};

// Auto-render on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => KeyWitness.autoRender());
} else {
  KeyWitness.autoRender();
}

(window as unknown as Record<string, unknown>).KeyWitness = KeyWitness;
export default KeyWitness;
