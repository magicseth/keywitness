import Nav from "../components/Nav";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Privacy Policy</h1>
        <p className="text-gray-500 text-sm mb-10">Last updated: March 15, 2026</p>

        <div className="space-y-8 text-[15px] leading-relaxed text-gray-400">

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Summary</h2>
            <p>
              KeyWitness is designed so that we <strong className="text-white">cannot</strong> read
              what you type. Your text is encrypted on your device before it ever leaves. We have no
              accounts, no tracking, no analytics, and no ads. The server stores encrypted data it
              cannot decrypt.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">What the Keyboard Collects</h2>
            <p className="mb-3">
              When you tap <strong className="text-white">Seal</strong>, and only then, the keyboard collects:
            </p>
            <ul className="list-disc list-inside space-y-1.5 ml-1">
              <li><strong className="text-gray-300">Keystroke timing</strong> — when each key was pressed and released (millisecond timestamps)</li>
              <li><strong className="text-gray-300">Touch position</strong> — where on the key your finger landed (x, y coordinates)</li>
              <li><strong className="text-gray-300">Touch pressure and radius</strong> — how hard and how broadly you pressed</li>
              <li><strong className="text-gray-300">The text you typed</strong> — encrypted with AES-256-GCM before upload</li>
            </ul>
            <p className="mt-3">
              This data is bundled into a W3C Verifiable Credential, signed with your device's Ed25519 key,
              and encrypted. The keyboard <strong className="text-white">does not</strong> collect, transmit, or store
              keystrokes at any other time. It does not monitor what you type in other apps. It does not
              send data in the background.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Why Full Access Is Required</h2>
            <p>
              iOS requires "Full Access" for a keyboard extension to make network requests. KeyWitness
              needs network access for one purpose: uploading the encrypted attestation to keywitness.io
              so you can share a verification link.
            </p>
            <p className="mt-3">
              With Full Access enabled, the keyboard <strong className="text-white">only</strong> communicates
              with keywitness.io, and <strong className="text-white">only</strong> when you tap Seal. It does not
              access contacts, location, photos, or any other data on your device.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Encryption</h2>
            <p>
              Your text is encrypted with AES-256-GCM on your device before upload. The encryption
              key is encoded into the URL fragment (the part after the #), which browsers never send
              to servers. This means:
            </p>
            <ul className="list-disc list-inside space-y-1.5 ml-1 mt-3">
              <li>The server stores an encrypted blob it cannot decrypt</li>
              <li>Only someone with the full link (including the fragment) can read the text</li>
              <li>We cannot read, moderate, or analyze your content</li>
              <li>We cannot comply with requests to reveal content because we don't have the key</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">What We Store on the Server</h2>
            <ul className="list-disc list-inside space-y-1.5 ml-1">
              <li>The encrypted attestation (we cannot read it)</li>
              <li>A short ID for the verification link</li>
              <li>A timestamp</li>
              <li>Device verification status (from Apple App Attest)</li>
              <li>An optional username (if you claimed one)</li>
              <li>A SHA-256 hash of your recovery email (if you set one — we never store the email itself)</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">What We Don't Collect</h2>
            <ul className="list-disc list-inside space-y-1.5 ml-1">
              <li>No accounts or passwords</li>
              <li>No email addresses (only a hash, and only if you opt into username recovery)</li>
              <li>No device identifiers beyond the public signing key</li>
              <li>No IP address logging</li>
              <li>No analytics, telemetry, or crash reporting</li>
              <li>No advertising identifiers</li>
              <li>No cookies or browser fingerprinting on the website</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Face ID</h2>
            <p>
              Face ID verification is optional. When used, Face ID runs entirely on your device via
              Apple's LocalAuthentication framework. No biometric data is sent to our server. The
              attestation records only that Face ID succeeded, not any biometric information.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">TrueDepth Face Tracking for Voice Attestation</h2>
            <p className="mb-3">
              Voice attestation exists for two reasons: <strong className="text-white">accessibility</strong> and{" "}
              <strong className="text-white">preventing user spoofing</strong>. It provides an alternative
              for users who cannot type — including those with motor impairments, repetitive strain injuries,
              or other conditions that make keyboard input difficult or impossible. TrueDepth face tracking
              prevents spoofing by verifying that a real person is physically speaking the words, not playing
              back a recording or using synthetic audio.
            </p>
            <p className="mb-3">
              During voice attestation, KeyWitness uses ARKit face tracking via the TrueDepth camera
              to capture mouth movement data — specifically, 12 mouth-related blend shape coefficients
              (such as jaw open, mouth smile, and lip movement) sampled at 20 frames per second. No full
              3D face geometry, eye tracking, iris data, or facial feature points are collected.
            </p>
            <p className="mb-3">
              <strong className="text-gray-300">Purpose:</strong> The app correlates mouth movement with
              spoken audio entirely on your device to verify liveness — proving that a real human physically
              spoke the words at the moment of attestation. This prevents spoofing via recording playback
              or synthetic voice. A SHA-256 hash of the mouth movement data is included in the attestation
              credential for integrity verification.
            </p>
            <p className="mb-3">
              <strong className="text-gray-300">Encryption and storage:</strong> The mouth blend shape
              data is encrypted with AES-256-GCM on your device before upload, alongside the audio and
              transcription. The server stores only the encrypted blob and cannot decrypt it — the
              decryption key lives in the URL fragment, which is never sent to the server.
            </p>
            <p>
              <strong className="text-gray-300">Sharing:</strong> Face tracking data is never shared
              with third parties. It is only accessible to someone who possesses the full verification
              link (including the decryption key in the URL fragment).
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Cryptographic Keys</h2>
            <p>
              Your Ed25519 signing key is generated in the device's Secure Enclave. The private key
              never leaves the hardware. The public key is included in attestations so verifiers can
              check signatures. If you reset or lose your device, the key is gone — we cannot recover it.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Third-Party Services</h2>
            <ul className="list-disc list-inside space-y-1.5 ml-1">
              <li><strong className="text-gray-300">Apple App Attest</strong> — used to verify the device is genuine. Apple's privacy policy applies to their service.</li>
              <li><strong className="text-gray-300">Convex</strong> — our backend hosting provider. They store encrypted data on our behalf.</li>
              <li><strong className="text-gray-300">Resend</strong> — used only for username recovery emails, if you opt in.</li>
            </ul>
            <p className="mt-3">We do not use any advertising, analytics, or social media SDKs.</p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Data Retention and Deletion</h2>
            <p>
              Attestations are stored indefinitely so verification links continue to work. You can
              revoke an attestation at any time, which marks it as revoked in the public status list
              but does not delete the encrypted data. Since we cannot read the content, we cannot
              perform content-based deletion, but we can delete the encrypted record upon request.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Children</h2>
            <p>
              KeyWitness is not directed at children under 13. We do not knowingly collect information
              from children.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Changes</h2>
            <p>
              If we change this policy, we will update this page and the date above. The app is open
              source at{" "}
              <a href="https://github.com/magicseth/keywitness" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                github.com/magicseth/keywitness
              </a>{" "}
              — you can verify our claims by reading the code.
            </p>
          </section>

          <section>
            <h2 className="text-white font-semibold text-lg mb-3">Contact</h2>
            <p>
              Questions about this policy:{" "}
              <a href="https://x.com/magicseth" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                @magicseth on X
              </a>{" "}
              or open an issue on{" "}
              <a href="https://github.com/magicseth/keywitness/issues" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                GitHub
              </a>.
            </p>
          </section>
        </div>

        <footer className="text-center text-gray-600 text-xs py-8 mt-10 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400 transition-colors">keywitness.io</a>
        </footer>
      </div>
    </div>
  );
}
