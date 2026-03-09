export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-10">
          <a href="/" className="text-gray-500 text-sm hover:text-gray-300 transition-colors">
            &larr; Back to verifier
          </a>
          <h1 className="text-3xl font-bold tracking-tight text-white mt-4 mb-2">
            How KeyWitness Works
          </h1>
          <p className="text-gray-400 text-lg">
            Cryptographic proof that text was human-typed on a specific device.
          </p>
        </div>

        <div className="space-y-8">
          <Section title="The Problem">
            <p>
              How do you prove that a piece of text was actually typed by a
              human, on a specific device, at a specific time? With AI-generated
              content becoming indistinguishable from human writing, there's no
              reliable way to verify authorship.
            </p>
          </Section>

          <Section title="The Solution">
            <p>
              KeyWitness is a custom iOS keyboard that captures cryptographic
              proof as you type. Every keystroke is recorded with its timing,
              touch position, and contact radius. When you're done, the keyboard
              signs the text with a device-bound Ed25519 key and uploads the
              attestation.
            </p>
          </Section>

          <Section title="How Signing Works">
            <Steps
              steps={[
                {
                  num: "1",
                  title: "You type with the KeyWitness keyboard",
                  desc: "Each keystroke is recorded with sub-millisecond timing, touch position (x/y on each key), and contact radius.",
                },
                {
                  num: "2",
                  title: "You tap Attest",
                  desc: "The keyboard constructs a canonical JSON payload with a SHA-256 hash of the cleartext, device ID, timestamp, biometrics hash, and biometric verification status.",
                },
                {
                  num: "3",
                  title: "Ed25519 signature",
                  desc: "The payload is signed with a device-bound Ed25519 private key (generated on first use via Apple CryptoKit, stored in the app's secure container).",
                },
                {
                  num: "4",
                  title: "Client-side encryption",
                  desc: "The cleartext is encrypted with a random AES-256-GCM key. Only the encrypted form is uploaded to the server. The decryption key is placed in the URL fragment (#), which is never sent to the server.",
                },
                {
                  num: "5",
                  title: "Upload and share",
                  desc: "The attestation (with encrypted cleartext) is uploaded. You get a link like keywitness.io/v/abc123#key that you can share. Anyone with the link can verify it.",
                },
              ]}
            />
          </Section>

          <Section title="What Gets Signed">
            <p className="mb-3">
              The Ed25519 signature covers this exact JSON structure (keys
              sorted alphabetically, no whitespace):
            </p>
            <pre className="bg-[#111111] border border-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto">
{`{
  "cleartextHash": "<SHA-256 of the text>",
  "deviceId": "<device UUID>",
  "faceIdVerified": true,
  "keystrokeBiometricsHash": "<SHA-256 of keystroke data>",
  "timestamp": "<ISO 8601>",
  "version": "keywitness-v2"
}`}
            </pre>
            <p className="mt-3 text-sm text-gray-500">
              Note: the cleartext itself is NOT in the signed payload. Only its
              hash is signed, so the signature doesn't reveal what was written.
            </p>
          </Section>

          <Section title="Zero-Knowledge Server">
            <p>
              The server stores only the encrypted attestation. It never sees:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li>The original cleartext</li>
              <li>The AES decryption key (it's in the URL fragment)</li>
              <li>The private signing key (it never leaves the device)</li>
            </ul>
            <p className="mt-3">
              Verification happens entirely in the browser using the Web Crypto
              API and tweetnacl. No data is sent back to any server.
            </p>
          </Section>

          <Section title="Biometric Verification">
            <p>
              Face ID or Touch ID verification is performed in the KeyWitness
              container app and shared with the keyboard via an App Group. The
              attestation records whether biometric verification was active:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li>
                <strong>Keyboard unlock</strong> requires a biometric session
                within 10 minutes
              </li>
              <li>
                <strong>Attestation</strong> requires a fresh session within 2
                minutes
              </li>
            </ul>
          </Section>

          <Section title="Keystroke Biometrics">
            <p>
              Each keystroke captures timing and touch data that creates a
              unique typing fingerprint:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li>
                <strong>Timing</strong> &mdash; key-down and key-up timestamps
                (sub-millisecond), dwell time, inter-key gaps
              </li>
              <li>
                <strong>Touch position</strong> &mdash; x/y coordinates within
                each key (nobody hits dead center every time)
              </li>
              <li>
                <strong>Contact radius</strong> &mdash; finger contact area
                varies between people and between keystrokes
              </li>
            </ul>
            <p className="mt-3">
              This data is included in the attestation (outside the signed
              payload) and visualized on the verification page.
            </p>
          </Section>

          <Section title="Key Registry">
            <p>
              Users can register their public key with a display name. When
              someone verifies an attestation, the page shows who the key is
              registered to. You can also save keys locally in your browser for
              quick recognition.
            </p>
          </Section>

          <Section title="Trust Model">
            <div>
              <h4 className="text-gray-300 font-medium mb-1">It proves:</h4>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>Text was typed on a device with the given key</li>
                <li>Text hasn't been modified since signing</li>
                <li>The attestation was created at the stated time</li>
                <li>
                  Biometric verification was (or wasn't) active at attestation
                  time
                </li>
                <li>Keystroke patterns are consistent with human typing</li>
              </ul>
            </div>
            <div className="mt-3">
              <h4 className="text-gray-300 font-medium mb-1">
                It does not prove:
              </h4>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>The identity of the typist (only the device)</li>
                <li>That the device hasn't been compromised</li>
                <li>That the text was typed voluntarily</li>
                <li>That someone didn't dictate the text to the typist</li>
              </ul>
            </div>
          </Section>

          <Section title="Open Protocol">
            <p>
              The attestation format is simple and open. Any Ed25519
              implementation can verify signatures. The canonical JSON format is
              deterministic (alphabetically sorted keys, no whitespace).
              AES-256-GCM encryption uses standard Web Crypto / CryptoKit APIs.
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

function Steps({
  steps,
}: {
  steps: Array<{ num: string; title: string; desc: string }>;
}) {
  return (
    <div className="space-y-4">
      {steps.map((step) => (
        <div key={step.num} className="flex gap-4">
          <div className="shrink-0 w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center text-sm font-bold">
            {step.num}
          </div>
          <div>
            <div className="text-gray-200 font-medium">{step.title}</div>
            <div className="text-gray-500 text-sm mt-0.5">{step.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
