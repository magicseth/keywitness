import Nav from "../components/Nav";

export default function Developers() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            Developer Integration
          </h1>
          <p className="text-gray-400 text-lg">
            Add human-typed verification badges to your app in minutes.
          </p>
        </div>

        <div className="space-y-8">
          {/* Embed SDK */}
          <Section title="Embed SDK (Easiest)">
            <p>
              Drop a single script tag into your page. The SDK auto-discovers
              elements and renders verification badges.
            </p>
            <Code>{`<script src="https://keywitness.io/embed.js"></script>

<!-- Add a badge anywhere -->
<span data-keywitness="abc123" data-keywitness-style="inline"></span>`}</Code>
            <p className="mt-3">
              The SDK finds all <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">data-keywitness</code> elements
              on page load and renders iframe badges automatically.
            </p>
          </Section>

          {/* JavaScript API */}
          <Section title="JavaScript API">
            <p>For programmatic control, use the global <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">KeyWitness</code> object:</p>
            <Code>{`<script src="https://keywitness.io/embed.js"></script>
<script>
  // Render a badge into #my-element
  const badge = KeyWitness.badge('#my-element', 'abc123', {
    style: 'card',    // 'inline' | 'card' | 'floating'
    theme: 'dark',    // 'light' | 'dark' | 'auto'
    onVerified(result) {
      console.log('Verification:', result);
    }
  });

  // Later: update or remove
  badge.update('newShortId');
  badge.destroy();
</script>`}</Code>
          </Section>

          {/* Badge Styles */}
          <Section title="Badge Styles">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="py-2 pr-4 font-medium">Style</th>
                    <th className="py-2 pr-4 font-medium">Size</th>
                    <th className="py-2 font-medium">Use Case</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-gray-800/50">
                    <td className="py-2 pr-4"><code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">inline</code></td>
                    <td className="py-2 pr-4 text-gray-500">200 x 28px</td>
                    <td className="py-2">Bylines, comment headers, next to content</td>
                  </tr>
                  <tr className="border-b border-gray-800/50">
                    <td className="py-2 pr-4"><code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">card</code></td>
                    <td className="py-2 pr-4 text-gray-500">320 x 180px</td>
                    <td className="py-2">Standalone verification cards, sidebars</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">floating</code></td>
                    <td className="py-2 pr-4 text-gray-500">48 x 48px</td>
                    <td className="py-2">Fixed-position overlay on content</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <h4 className="text-gray-300 font-medium mt-4 mb-2">HTML Attributes</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="py-2 pr-4 font-medium">Attribute</th>
                    <th className="py-2 pr-4 font-medium">Required</th>
                    <th className="py-2 font-medium">Values</th>
                  </tr>
                </thead>
                <tbody className="text-gray-300">
                  <tr className="border-b border-gray-800/50">
                    <td className="py-2 pr-4"><code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">data-keywitness</code></td>
                    <td className="py-2 pr-4">Yes</td>
                    <td className="py-2">Attestation short ID</td>
                  </tr>
                  <tr className="border-b border-gray-800/50">
                    <td className="py-2 pr-4"><code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">data-keywitness-style</code></td>
                    <td className="py-2 pr-4">No</td>
                    <td className="py-2"><code className="text-gray-500 text-xs">inline</code> (default), <code className="text-gray-500 text-xs">card</code>, <code className="text-gray-500 text-xs">floating</code></td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-4"><code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">data-keywitness-theme</code></td>
                    <td className="py-2 pr-4">No</td>
                    <td className="py-2"><code className="text-gray-500 text-xs">auto</code> (default), <code className="text-gray-500 text-xs">light</code>, <code className="text-gray-500 text-xs">dark</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          {/* REST API */}
          <Section title="REST API">
            <p>
              Verify attestations server-side without the embed SDK. All endpoints return JSON.
            </p>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/30 text-blue-400 mr-2">GET</span>
              /api/verify?id=&#123;shortId&#125;
            </h4>
            <p>Verify an attestation by its short ID.</p>
            <Code>{`const resp = await fetch('https://keywitness.io/api/verify?id=abc123');
const result = await resp.json();

// Response:
{
  "shortId": "abc123",
  "url": "https://keywitness.io/v/abc123",
  "valid": true,
  "version": "v3",
  "deviceId": "4BF95BEA-...",
  "timestamp": "2026-03-09T04:07:41.132Z",
  "issuerDID": "did:key:z6Mk...",
  "publicKeyFingerprint": "a1:b2:c3:...",
  "appAttestPresent": true,
  "deviceVerified": true,
  "proofs": [
    { "proofType": "keystrokeAttestation", "valid": true },
    { "proofType": "deviceAttestation", "valid": true }
  ]
}`}</Code>

            <h4 className="text-gray-300 font-medium mt-6 mb-2">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-green-900/30 text-green-400 mr-2">POST</span>
              /api/verify
            </h4>
            <p>Verify a raw attestation PEM block. Full server-side cryptographic verification.</p>
            <Code>{`const resp = await fetch('https://keywitness.io/api/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    attestation: '-----BEGIN KEYWITNESS ATTESTATION-----\\n...\\n-----END KEYWITNESS ATTESTATION-----'
  })
});
const result = await resp.json();`}</Code>

            <h4 className="text-gray-300 font-medium mt-6 mb-2">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/30 text-blue-400 mr-2">GET</span>
              /api/oembed?url=&#123;url&#125;
            </h4>
            <p>
              oEmbed endpoint for rich embeds in Slack, Discord, and CMS tools. Returns
              a <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">rich</code> oEmbed
              response with an iframe.
            </p>
          </Section>

          {/* oEmbed & Social Previews */}
          <Section title="Social Previews">
            <p>
              Every verification URL (<code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">keywitness.io/v/&#123;id&#125;</code>)
              includes OpenGraph, Twitter Card, and oEmbed metadata. Share a link and it
              renders a rich preview automatically in Slack, Discord, Twitter, iMessage, etc.
            </p>
          </Section>

          {/* CSP */}
          <Section title="Content Security Policy">
            <p>If your site uses CSP headers, allow the KeyWitness iframe and script:</p>
            <Code>{`frame-src https://keywitness.io;
script-src https://keywitness.io;`}</Code>
          </Section>

          {/* Events */}
          <Section title="postMessage Events">
            <p>Badge iframes communicate verification results to the parent page:</p>
            <Code>{`window.addEventListener('message', (event) => {
  if (event.origin !== 'https://keywitness.io') return;

  if (event.data.type === 'keywitness:verified') {
    console.log(event.data.shortId, event.data.result);
  }
});`}</Code>
          </Section>

          {/* W3C Standards */}
          <Section title="Standards">
            <p>
              KeyWitness v3 attestations are{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                W3C Verifiable Credentials 2.0
              </a>{" "}
              documents using the{" "}
              <a href="https://www.w3.org/TR/vc-di-eddsa/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                eddsa-jcs-2022
              </a>{" "}
              Data Integrity cryptosuite. Any VC-compatible verifier can validate them independently.
            </p>
            <p className="mt-2">
              Issuer identity uses{" "}
              <a href="https://w3c-ccg.github.io/did-method-key/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                did:key
              </a>{" "}
              with Ed25519 public keys. The JSON-LD context is published at{" "}
              <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">keywitness.io/ns/v1</code>.
            </p>
          </Section>
        </div>

        <footer className="text-center text-gray-600 text-xs py-8 mt-10 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400 transition-colors">
            keywitness.io
          </a>
        </footer>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-gray-800 rounded-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-3">{title}</h2>
      <div className="text-sm text-gray-400 space-y-2">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-[#111111] border border-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto mt-2">
      <code>{children}</code>
    </pre>
  );
}
