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

          {/* BLE Web Attestation */}
          <Section title="BLE Web Attestation">
            <p>
              Let users attest text typed on any website using their iPhone as a hardware trust anchor.
              The phone connects via Bluetooth, receives keystroke timing in real time, then signs with
              Face ID + App Attest.
            </p>
            <Code>{`<script src="https://keywitness.io/embed.js"></script>
<script>
  // One-liner: attach to any form
  KeyWitness.attestForm('#my-form', '#my-textarea', {
    onAttestation(result) {
      console.log(result.attestationBlock);
    }
  });
</script>`}</Code>
            <p className="mt-3">
              Or use the lower-level API for full control:
            </p>
            <Code>{`// Check browser support
if (KeyWitness.ble.isSupported()) {
  const conn = await KeyWitness.ble.connect();
  console.log('Connected to', conn.session.deviceDID);

  // Send keystrokes as user types
  textarea.addEventListener('keyup', (e) => {
    conn.sendKeystroke(e.key, downMs, upMs);
  });

  // Request attestation (triggers Face ID on phone)
  const result = await conn.requestAttestation(textarea.value);
  // result.attestationBlock = PEM-encoded W3C VC 2.0
}`}</Code>
            <p className="mt-3">
              <a href="/demo" className="text-blue-400 hover:underline font-medium">
                Try the live demo &rarr;
              </a>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Requires Chrome or Edge. Safari and Firefox do not support Web Bluetooth.
            </p>
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

          {/* Username API */}
          <Section title="Username API">
            <p>
              Users can claim a username to get short links like <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">typed.by/username/1</code>.
              Usernames are bound to Ed25519 public keys.
            </p>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-green-900/30 text-green-400 mr-2">POST</span>
              /api/usernames/claim
            </h4>
            <p>Claim a username. Requires a public key and recovery email.</p>
            <Code>{`const resp = await fetch('https://keywitness.io/api/usernames/claim', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'magicseth',
    publicKey: '<base64url Ed25519 public key>',
    email: 'recovery@example.com'
  })
});
// 201: { "username": "magicseth", "alreadyClaimed": false }
// 409: { "error": "Username is already taken." }`}</Code>

            <h4 className="text-gray-300 font-medium mt-6 mb-2">
              <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-blue-900/30 text-blue-400 mr-2">GET</span>
              /api/resolve?username=&#123;name&#125;&amp;seq=&#123;n&#125;
            </h4>
            <p>Resolve a vanity URL to its attestation short ID.</p>
            <Code>{`const resp = await fetch('https://keywitness.io/api/resolve?username=magicseth&seq=42');
// 200: { "shortId": "aBcDeFg123" }
// 404: { "error": "Not found" }`}</Code>
            <p className="mt-2">
              When a user with a claimed username seals text, the server automatically
              assigns a sequential number and returns a <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">typed.by</code> URL
              instead of the default <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">keywitness.io/v/</code> URL.
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

          {/* Emoji Key Encoding */}
          <Section title="Emoji Key Encoding">
            <p>
              KeyWitness encodes the 256-bit AES decryption key as 27 human emoji in the URL
              fragment (<code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">#</code>).
              This spec is everything you need to write a compatible encoder/decoder.
            </p>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">Alphabet</h4>
            <p>
              129 Unicode <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">Emoji_Modifier_Base</code> codepoints,
              each with 6 variants (no skin tone + 5 Fitzpatrick modifiers) = <strong className="text-white">774 symbols</strong>.
            </p>
            <p className="mt-2">
              Skin tone modifiers (appended as a second codepoint):
            </p>
            <Code>{`none   (base emoji alone — yellow default)
U+1F3FB  🏻  Type-1-2  (light)
U+1F3FC  🏼  Type-3    (medium-light)
U+1F3FD  🏽  Type-4    (medium)
U+1F3FE  🏾  Type-5    (medium-dark)
U+1F3FF  🏿  Type-6    (dark)`}</Code>

            <p className="mt-3">
              The 129 base codepoints, in order (hex):
            </p>
            <Code>{`261D 26F9 270A 270B 270C 270D
1F385 1F3C2 1F3C3 1F3C4 1F3C7 1F3CA 1F3CB 1F3CC
1F442 1F443 1F446 1F447 1F448 1F449 1F44A 1F44B
1F44C 1F44D 1F44E 1F44F 1F450
1F466 1F467 1F468 1F469 1F46B 1F46C 1F46D 1F46E
1F470 1F471 1F472 1F473 1F474 1F475 1F476 1F477
1F478 1F47C
1F481 1F482 1F483 1F485 1F486 1F487 1F4AA
1F574 1F575 1F57A 1F590 1F595 1F596
1F645 1F646 1F647 1F64B 1F64C 1F64D 1F64E 1F64F
1F6A3 1F6B4 1F6B5 1F6B6 1F6C0 1F6CC
1F90C 1F90F 1F918 1F919 1F91A 1F91B 1F91C 1F91D
1F91E 1F91F
1F926 1F930 1F931 1F932 1F933 1F934 1F935 1F936
1F937 1F938 1F939 1F93D 1F93E
1F977 1F9B5 1F9B6 1F9B8 1F9B9 1F9BB
1F9CD 1F9CE 1F9CF 1F9D1 1F9D2 1F9D3 1F9D4 1F9D5
1F9D6 1F9D7 1F9D8 1F9D9 1F9DA 1F9DB 1F9DC 1F9DD
1FAC3 1FAC4 1FAC5
1FAF0 1FAF1 1FAF2 1FAF3 1FAF4 1FAF5 1FAF6 1FAF7 1FAF8`}</Code>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">Symbol index</h4>
            <p>
              Each base codepoint gets 6 consecutive indices. For base <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">i</code> (0-indexed
              in the list above):
            </p>
            <Code>{`index = i * 6 + tone_offset

tone_offset:
  0 = no modifier (yellow)
  1 = U+1F3FB
  2 = U+1F3FC
  3 = U+1F3FD
  4 = U+1F3FE
  5 = U+1F3FF

Total symbols: 129 × 6 = 774`}</Code>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">Encoding algorithm</h4>
            <Code>{`function encode(key: Uint8Array[32]) -> string:
    // 1. Interpret the 32 bytes as a big-endian unsigned integer
    n = bytes_to_bigint(key)  // big-endian

    // 2. Convert to base-774, least-significant digit first
    digits = []
    for i in 0..27:
        digits.push(n % 774)
        n = n / 774            // integer division

    // 3. Map each digit to its emoji
    return digits.map(d => alphabet[d]).join("")`}</Code>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">Decoding algorithm</h4>
            <Code>{`function decode(emoji_string: string) -> Uint8Array[32]:
    // 1. Parse emoji (handle 2-codepoint skin-tone sequences)
    indices = parse_emoji_to_indices(emoji_string)
    assert len(indices) == 27

    // 2. Reconstruct the big integer (most-significant digit last)
    n = 0
    for i in 26..0 (reverse):
        n = n * 774 + indices[i]

    // 3. Convert back to 32 big-endian bytes
    return bigint_to_bytes(n, 32)`}</Code>

            <h4 className="text-gray-300 font-medium mt-4 mb-2">Test vectors</h4>
            <Code>{`// All zeros (32 bytes of 0x00)
key:   AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
emoji: ☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝☝

// Incrementing (0x00 0x01 0x02 ... 0x1F)
key:   AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8
emoji: 🧔🏻🤌🏾👃🏻💂🏿🧚🏼🤽🤛🏿🤲🏾☝🏼🚴🏼🚴👱🧚🏾👉🏿🕴🏽🤞🏿🥷🏼👰🏻👮🏼🖕🏼🫃🏽👌🏽👆🏼👷🏻🏄🏿☝🏻☝`}</Code>
            <p className="mt-2 text-xs text-gray-500">
              The key is base64url-encoded (no padding). Use the reference implementation
              at <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">src/lib/stegkey.ts</code> to
              generate additional test vectors.
            </p>
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
