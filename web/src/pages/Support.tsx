import Nav from "../components/Nav";

export default function Support() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-white mb-2">Support</h1>
        <p className="text-gray-500 text-sm mb-10">Get help with KeyWitness</p>

        <div className="space-y-6">

          <div className="border border-gray-800 rounded-xl p-6 bg-[#0d0d0d]">
            <h2 className="text-white font-semibold text-lg mb-2">Common Questions</h2>
            <div className="space-y-4 text-[15px] text-gray-400">
              <details className="group">
                <summary className="text-gray-300 cursor-pointer hover:text-white transition-colors font-medium">
                  How do I enable the KeyWitness keyboard?
                </summary>
                <p className="mt-2 pl-1">
                  Go to Settings → General → Keyboard → Keyboards → Add New Keyboard → KeyWitness.
                  Then tap KeyWitness in the list and enable "Allow Full Access."
                </p>
              </details>

              <details className="group">
                <summary className="text-gray-300 cursor-pointer hover:text-white transition-colors font-medium">
                  Why does the keyboard need Full Access?
                </summary>
                <p className="mt-2 pl-1">
                  Full Access allows the keyboard to upload your encrypted attestation to keywitness.io
                  so you can share a verification link. The keyboard only communicates when you tap Seal.
                  It never transmits your keystrokes or the text you type.
                </p>
              </details>

              <details className="group">
                <summary className="text-gray-300 cursor-pointer hover:text-white transition-colors font-medium">
                  Can you read what I type?
                </summary>
                <p className="mt-2 pl-1">
                  No. Your text is encrypted with AES-256-GCM on your device before upload. The decryption
                  key is embedded in the URL fragment, which is never sent to our server. We store an
                  encrypted blob we cannot decrypt.
                </p>
              </details>

              <details className="group">
                <summary className="text-gray-300 cursor-pointer hover:text-white transition-colors font-medium">
                  What happens if I lose my phone?
                </summary>
                <p className="mt-2 pl-1">
                  Your signing key lives in the device's Secure Enclave and cannot be recovered. Existing
                  attestations will still verify, but you won't be able to create new ones with the same
                  key. If you claimed a username, you can recover it on a new device using your recovery email.
                </p>
              </details>

              <details className="group">
                <summary className="text-gray-300 cursor-pointer hover:text-white transition-colors font-medium">
                  Is Face ID required?
                </summary>
                <p className="mt-2 pl-1">
                  No. Face ID is optional. It adds an extra layer of trust by proving the phone's owner
                  approved the message. Attestations work without it.
                </p>
              </details>

              <details className="group">
                <summary className="text-gray-300 cursor-pointer hover:text-white transition-colors font-medium">
                  How do I verify someone else's message?
                </summary>
                <p className="mt-2 pl-1">
                  Open the verification link they shared. Your browser checks every signature and hash
                  client-side — no server trust required. You can also go to{" "}
                  <a href="/verify" className="text-blue-400 hover:underline">keywitness.io/verify</a>{" "}
                  and paste an attestation block directly.
                </p>
              </details>
            </div>
          </div>

          <div className="border border-gray-800 rounded-xl p-6 bg-[#0d0d0d]">
            <h2 className="text-white font-semibold text-lg mb-2">Get Help</h2>
            <div className="space-y-3 text-[15px] text-gray-400">
              <p>
                <strong className="text-gray-300">Report a bug or request a feature:</strong>{" "}
                <a href="https://github.com/magicseth/keywitness/issues" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                  GitHub Issues
                </a>
              </p>
              <p>
                <strong className="text-gray-300">General questions:</strong>{" "}
                <a href="https://x.com/magicseth" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                  @magicseth on X
                </a>
              </p>
              <p>
                <strong className="text-gray-300">Source code:</strong>{" "}
                <a href="https://github.com/magicseth/keywitness" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                  github.com/magicseth/keywitness
                </a>
              </p>
            </div>
          </div>

          <div className="border border-gray-800 rounded-xl p-6 bg-[#0d0d0d]">
            <h2 className="text-white font-semibold text-lg mb-2">Documentation</h2>
            <div className="flex flex-wrap gap-4 text-sm">
              <a href="/how" className="text-blue-400 hover:underline">How It Works</a>
              <a href="/developers" className="text-blue-400 hover:underline">Developer Docs</a>
              <a href="/manifesto" className="text-blue-400 hover:underline">Humanifesto</a>
              <a href="/privacy" className="text-blue-400 hover:underline">Privacy Policy</a>
            </div>
          </div>
        </div>

        <footer className="text-center text-gray-600 text-xs py-8 mt-10 border-t border-gray-800">
          <a href="/" className="hover:text-gray-400 transition-colors">keywitness.io</a>
        </footer>
      </div>
    </div>
  );
}
