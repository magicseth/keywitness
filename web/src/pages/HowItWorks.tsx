import Nav from "../components/Nav";

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            How KeyWitness Works
          </h1>
          <p className="text-gray-400 text-lg">
            Cryptographic proof that text was human-typed on a real device.
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
              seals the text with a standards-compliant digital signature and
              uploads the attestation.
            </p>
          </Section>

          <Section title="How It Works">
            <Steps
              steps={[
                {
                  num: "1",
                  title: "You type with the KeyWitness keyboard",
                  desc: "Each keystroke is recorded with sub-millisecond timing, touch position (x/y), contact radius, and force. This data is unique to the typist — like a fingerprint.",
                },
                {
                  num: "2",
                  title: "You tap Seal",
                  desc: "The keyboard builds a W3C Verifiable Credential containing a SHA-256 hash of the text, device ID, timestamp, and keystroke biometrics hash.",
                },
                {
                  num: "3",
                  title: "Cryptographic signing",
                  desc: "The credential is signed using eddsa-jcs-2022 (Ed25519 over JCS-canonicalized JSON). The private key is device-bound and never leaves the device.",
                },
                {
                  num: "4",
                  title: "Apple App Attest",
                  desc: "The keyboard generates an App Attest assertion proving the attestation came from a genuine Apple device running the real KeyWitness app — not an emulator or modified build.",
                },
                {
                  num: "5",
                  title: "Client-side encryption",
                  desc: "The cleartext and keystroke data are encrypted with a random AES-256-GCM key. Only the encrypted form is uploaded. The decryption key lives in the URL fragment (#), which is never sent to the server.",
                },
                {
                  num: "6",
                  title: "Upload and share",
                  desc: "The attestation is uploaded and you get a link like keywitness.io/v/abc123#key. Anyone with the link can verify it entirely in their browser.",
                },
              ]}
            />
          </Section>

          <Section title="The Proof Chain">
            <p>
              Each attestation contains multiple independent proofs that are verified separately:
            </p>
            <div className="space-y-3 mt-3">
              <ProofItem
                icon="K"
                color="blue"
                title="Keystroke Attestation"
                desc="Ed25519 signature over the credential using eddsa-jcs-2022. Proves the text hasn't been modified and was signed by the device's key."
              />
              <ProofItem
                icon="D"
                color="green"
                title="Device Attestation (App Attest)"
                desc="Apple's DCAppAttestService proves the assertion came from a real Apple device running the genuine KeyWitness app. Not an emulator, not a modified build."
              />
              <ProofItem
                icon="F"
                color="purple"
                title="Biometric Verification (Face ID)"
                desc="Optional. The device owner confirms the message with Face ID after typing. A separate signature proves the biometric check happened."
              />
            </div>
          </Section>

          <Section title="W3C Verifiable Credentials">
            <p>
              KeyWitness v3 attestations use the{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                W3C Verifiable Credentials 2.0
              </a>{" "}
              data model with the{" "}
              <a href="https://www.w3.org/TR/vc-di-eddsa/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                eddsa-jcs-2022
              </a>{" "}
              Data Integrity cryptosuite. This means:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li>Any VC-compatible verifier can validate attestations independently</li>
              <li>Issuer identity uses <a href="https://w3c-ccg.github.io/did-method-key/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">did:key</a> with Ed25519 public keys</li>
              <li>JSON Canonicalization Scheme (JCS / RFC 8785) ensures deterministic signing</li>
              <li>Proof values are multibase-encoded (z + base58btc)</li>
            </ul>
            <p className="mt-3">
              The credential structure:
            </p>
            <pre className="bg-[#111111] border border-gray-800 rounded-lg p-4 text-sm text-gray-300 overflow-x-auto mt-2">
{`{
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://keywitness.io/ns/v1"
  ],
  "type": ["VerifiableCredential", "KeyWitnessAttestation"],
  "issuer": "did:key:z6Mk...",
  "validFrom": "2026-03-09T04:07:41.132Z",
  "credentialSubject": {
    "type": "HumanTypedContent",
    "cleartextHash": "<SHA-256>",
    "encryptedCleartext": "<AES-256-GCM>",
    "deviceId": "<UUID>",
    "keystrokeBiometricsHash": "<SHA-256>",
    "appVersion": "1.0"
  },
  "proof": [
    { "type": "DataIntegrityProof", "cryptosuite": "eddsa-jcs-2022", ... },
    { "type": "AppleAppAttestProof", "keyId": "...", "assertionData": "..." }
  ]
}`}
            </pre>
          </Section>

          <Section title="Zero-Knowledge Server">
            <p>
              The server stores only the encrypted attestation. It never sees:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li>The original text (only the AES-encrypted form)</li>
              <li>The decryption key (it stays in the URL fragment)</li>
              <li>The private signing key (it never leaves the device)</li>
            </ul>
            <p className="mt-3">
              Verification happens entirely in the browser using the Web Crypto
              API and tweetnacl. No data is sent back to any server during
              verification.
            </p>
          </Section>

          <Section title="Keystroke Biometrics">
            <p>
              Each keystroke captures timing and touch data that creates a
              unique typing fingerprint:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li>
                <strong>Timing</strong> — key-down and key-up timestamps
                (sub-millisecond), dwell time, inter-key gaps
              </li>
              <li>
                <strong>Touch position</strong> — x/y coordinates within
                each key (nobody hits dead center every time)
              </li>
              <li>
                <strong>Contact radius</strong> — finger contact area
                varies between people and between keystrokes
              </li>
              <li>
                <strong>Force</strong> — how firmly each key is pressed
              </li>
            </ul>
            <p className="mt-3">
              This data is encrypted alongside the cleartext and visualized on
              the verification page as a typing pattern timeline and touch map.
            </p>
          </Section>

          <Section title="Trust Model">
            <div>
              <h4 className="text-gray-300 font-medium mb-1">It proves:</h4>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>Text was typed on a device with the given signing key</li>
                <li>Text hasn't been modified since signing</li>
                <li>The attestation was created at the stated time</li>
                <li>If device-verified: it came from the real KeyWitness app on a genuine Apple device</li>
                <li>If Face ID confirmed: the device owner personally verified the message</li>
                <li>Keystroke patterns are consistent with human typing</li>
              </ul>
            </div>
            <div className="mt-3">
              <h4 className="text-gray-300 font-medium mb-1">
                It does not prove:
              </h4>
              <ul className="list-disc list-inside space-y-1 ml-1">
                <li>The identity of the typist (only the device)</li>
                <li>That the text was typed voluntarily</li>
                <li>That someone didn't dictate the text to the typist</li>
              </ul>
            </div>
          </Section>

          <Section title="Open Protocol">
            <p>
              The attestation format is based on open W3C standards. Any Ed25519
              implementation can verify signatures. The JSON-LD context is published
              at{" "}
              <a href="/ns/v1" className="text-blue-400 hover:underline">keywitness.io/ns/v1</a>.
              Provider capabilities are listed at{" "}
              <a href="/.well-known/keywitness-providers.json" className="text-blue-400 hover:underline">
                .well-known/keywitness-providers.json
              </a>.
            </p>
            <p className="mt-2">
              Want to integrate KeyWitness verification into your app?
              Check the{" "}
              <a href="/developers" className="text-blue-400 hover:underline">
                Developer docs
              </a>.
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

function ProofItem({
  icon,
  color,
  title,
  desc,
}: {
  icon: string;
  color: string;
  title: string;
  desc: string;
}) {
  const colors: Record<string, string> = {
    blue: "bg-blue-900/50 text-blue-400 border-blue-800",
    green: "bg-green-900/50 text-green-400 border-green-800",
    purple: "bg-purple-900/50 text-purple-400 border-purple-800",
  };
  return (
    <div className="flex gap-3">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border shrink-0 ${colors[color]}`}>
        {icon}
      </div>
      <div>
        <div className="text-gray-200 font-medium text-sm">{title}</div>
        <div className="text-gray-500 text-sm mt-0.5">{desc}</div>
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
