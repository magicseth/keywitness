import Nav from "../components/Nav";

export default function Manifesto() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 py-12">
        <div className="mb-12">
          <h1 className="text-4xl font-bold tracking-tight text-white mb-3">
            The Humanifesto
          </h1>
          <p className="text-gray-400 text-lg leading-relaxed">
            On proving human authorship in the age of AI.
          </p>
        </div>

        <div className="space-y-10 text-[15px] leading-relaxed text-gray-300">

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">The Problem We All Face</h2>
            <p>
              We are entering a world where the default assumption about any text is
              that a machine wrote it. Emails, messages, essays, code reviews, love
              letters — all of it is suspect. The tools that generate text are now
              better at sounding human than most humans are at sounding like themselves.
            </p>
            <p className="mt-3">
              This isn't a technical curiosity. It's an erosion of trust at the most
              fundamental level of human communication. When you can't tell if a
              message came from a person or a prompt, every interaction carries a
              shadow of doubt.
            </p>
            <p className="mt-3">
              We believe this problem can be solved — not by detecting AI (a losing
              arms race), but by <em>proving humanity</em>. Not after the fact, but at
              the moment of creation.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">Our Approach</h2>
            <p>
              KeyWitness captures cryptographic proof at the point of input — the
              keyboard. Every keystroke is witnessed: its timing, the finger's position
              on the glass, the contact radius, the pressure. This data is unique to
              the typist, unique to the moment, and impossible to forge after the fact.
            </p>
            <p className="mt-3">
              When you seal a message, the keyboard builds a{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                W3C Verifiable Credential
              </a>{" "}
              — a self-contained, standards-compliant proof that can be verified by
              anyone, anywhere, without trusting us or any central authority. The
              signing key lives in the device's secure hardware. The private key never
              leaves. The credential is the proof.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">Principles</h2>

            <div className="space-y-6">
              <Principle title="Prove, don't detect.">
                AI detection is a statistical guess that degrades over time.
                Cryptographic proof is mathematical certainty that gets stronger with
                every independent verification. We chose proof.
              </Principle>

              <Principle title="The device is the witness, not the server.">
                The signing key lives in your device's Secure Enclave. The server
                never sees the cleartext, the private key, or the decryption key. It
                stores an encrypted blob it cannot read. Verification happens in the
                recipient's browser. The server is a convenience, not a dependency.
              </Principle>

              <Principle title="Standards over proprietary formats.">
                We use W3C Verifiable Credentials 2.0 with eddsa-jcs-2022 (Ed25519
                over RFC 8785 JCS canonicalization), did:key identifiers, and
                BitstringStatusList for revocation. Every piece is an open standard.
                Any conforming verifier can validate our credentials without knowing
                we exist.
              </Principle>

              <Principle title="Self-contained credentials.">
                A KeyWitness attestation carries everything needed to verify it: the
                public key, the signature, the proof chain. No phone-home. No API
                call. No expiration server. You could verify one on an air-gapped
                machine with nothing but an Ed25519 library and a JSON parser.
              </Principle>

              <Principle title="Privacy by architecture, not policy.">
                The cleartext is encrypted with AES-256-GCM before upload. The key
                lives in the URL fragment, which browsers never send to servers. We
                can't read what you wrote because we architecturally can't, not
                because we promise not to.
              </Principle>

              <Principle title="Human-centered, literally.">
                The encryption key is encoded as 27 emoji of human figures and
                gestures with diverse skin tones. This isn't decoration — it's a
                principled encoding choice. Read on.
              </Principle>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">Why Emoji</h2>
            <p>
              A 256-bit AES encryption key is 43 characters of base64. It looks like
              this:
            </p>
            <pre className="bg-[#111111] border border-gray-800 rounded-lg p-4 text-sm text-gray-400 overflow-x-auto mt-3 mb-3">
              K7gNU3sdo-OL0wNhqoVWhr3g6s1xYv72ol_pe_Unols
            </pre>
            <p>
              That string needs to travel with the link. It can't go to the server
              (privacy). It can't be invisible (messaging apps strip invisible
              characters). It needs to survive copy-paste across iMessage, WhatsApp,
              Slack, email, and every other place humans share links.
            </p>
            <p className="mt-3">
              We encode it as 27 human emoji.
            </p>
            <pre className="bg-[#111111] border border-gray-800 rounded-lg p-4 text-sm overflow-x-auto mt-3 mb-3">
              typed.by/magicseth/42#👵🏽🤳🤰🏾💁🏻🦹🏽✋🏾👂✋🏼🏊👨🏻💁🏽🧓🏼🧜🏼🫸🏽✍🧝🏼🏋🏼🤏🏻🚵🏿🧒🏻🏂🏿🤜🏻🚴🏻🫴🏽🖖🏽✊🏽
            </pre>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">The Encoding</h3>
            <p>
              Unicode defines 129 emoji that support Fitzpatrick skin tone modifiers —
              hands, people, gestures, figures. Each one has 6 visual variants: the
              default yellow plus 5 skin tones. That gives us an alphabet of 774
              symbols.
            </p>
            <p className="mt-3">
              Each symbol carries log<sub>2</sub>(774) ≈ 9.6 bits of information. A
              256-bit key requires ⌈256 / 9.6⌉ = 27 emoji. The key is treated as a
              big integer, converted to base-774, and each digit mapped to an emoji.
              Decoding reverses the process.
            </p>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">Why These Emoji</h3>
            <p>
              We chose the human emoji alphabet deliberately:
            </p>
            <ul className="list-disc list-inside space-y-2 ml-1 mt-3">
              <li>
                <strong>They're human.</strong> KeyWitness proves human authorship.
                The key that protects the message is literally composed of people —
                hands waving, people dancing, fingers pointing. The encoding is
                the message.
              </li>
              <li>
                <strong>They're diverse.</strong> Skin tone modifiers aren't just
                extra symbols — they represent real human diversity. A cryptographic
                key that uses the full spectrum of human representation is a key that
                says something about what it's protecting.
              </li>
              <li>
                <strong>They survive everything.</strong> Every platform renders emoji.
                Every messaging app preserves them. Every clipboard copies them
                faithfully. They work in URLs, in text messages, in emails. They are
                the most resilient visible encoding in Unicode.
              </li>
              <li>
                <strong>They're visible.</strong> Unlike invisible characters (which
                get stripped) or base64 (which looks like noise), emoji are obviously
                present. A recipient can see that the link carries something — even
                if they don't know it's a decryption key.
              </li>
              <li>
                <strong>They're dense.</strong> 774 symbols is remarkably efficient.
                27 emoji for 256 bits. A QR code would be larger. A hex string would
                be 64 characters. The emoji encoding is compact without being cryptic.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">How To Build Your Own</h2>
            <p>
              We want this to be an ecosystem, not a product. Here's how to build a
              human verification system that interoperates with ours and with everyone
              else's.
            </p>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">1. Use W3C Verifiable Credentials</h3>
            <p>
              Don't invent a format. Use{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                VC 2.0
              </a>.
              Your attestation is a JSON-LD document with a cryptographic proof. Any
              VC verifier can validate it. If you use a different proof method
              (ecdsa-rdfc-2019, BBS+, whatever), the ecosystem still understands
              your credentials.
            </p>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">2. Use did:key for Issuer Identity</h3>
            <p>
              <a href="https://w3c-ccg.github.io/did-method-key/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                did:key
              </a>{" "}
              encodes a public key as a DID — no resolution, no registry, no
              infrastructure. The identifier <em>is</em> the key. Verification is a
              local operation. This is critical for a decentralized system: you don't
              need anyone's permission to issue credentials, and you don't need
              anyone's server to verify them.
            </p>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">3. Capture What Your Platform Gives You</h3>
            <p>
              We capture keystrokes on iOS. You might build for:
            </p>
            <ul className="list-disc list-inside space-y-1 ml-1 mt-2">
              <li><strong>Android</strong> — InputMethodService gives you the same touch data. Use Play Integrity instead of App Attest.</li>
              <li><strong>Desktop</strong> — CGEventTap (macOS) or input hooks (Windows/Linux) give you keystroke timing. No touch data, but typing cadence is a strong biometric signal.</li>
              <li><strong>Hardware keyboards</strong> — A keyboard with a secure element could sign at the hardware level. Highest trust, lowest attack surface.</li>
              <li><strong>Browser extensions</strong> — WebAuthn for device binding, keystroke timing from DOM events. Less biometric data, but widely deployable.</li>
              <li><strong>Voice</strong> — Audio spectrograms, speech patterns, and speaker verification could attest that words were <em>spoken</em> by a human.</li>
            </ul>
            <p className="mt-3">
              The proof chain is extensible. Add whatever proof types your platform
              supports. The credential format accommodates multiple independent proofs
              in a single document.
            </p>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">4. Don't Trust Yourself</h3>
            <p>
              Design your system so the server can't cheat. Client-side encryption
              means you can't read the content. Self-contained credentials mean
              verification doesn't depend on you being online. did:key means you don't
              control the namespace. The less trust required in the operator, the more
              trustworthy the system.
            </p>

            <h3 className="text-lg font-medium text-white mt-6 mb-3">5. Publish Your Context</h3>
            <p>
              If you define new credential types or proof types, publish a JSON-LD
              context document so other verifiers can understand your credentials.
              Ours is at{" "}
              <a href="/ns/v1" className="text-blue-400 hover:underline">keywitness.io/ns/v1</a>.
              List your provider capabilities at{" "}
              <code className="bg-[#1f2937] px-1.5 py-0.5 rounded text-green-400 text-xs">.well-known/keywitness-providers.json</code>{" "}
              so others can discover what you support.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">How We Do It Together</h2>
            <p>
              The goal isn't one app or one company that verifies humanity. The goal is
              an ecosystem where any device, any platform, any keyboard can produce a
              credential that any verifier can validate.
            </p>

            <div className="space-y-4 mt-4">
              <Principle title="Interoperability through standards.">
                If your Android keyboard produces W3C VCs with eddsa-jcs-2022, our
                verifier validates them. If our iOS keyboard produces a credential,
                your verifier validates it. No partnership required. No API key. No
                business relationship. The math is the agreement.
              </Principle>

              <Principle title="Trust registries, not gatekeepers.">
                A trust registry lists known providers and their capabilities. It
                doesn't grant permission — it provides discovery. Anyone can publish
                a registry. Anyone can subscribe to multiple registries. The user
                decides who they trust, not us.
              </Principle>

              <Principle title="Revocation without control.">
                We use{" "}
                <a href="https://www.w3.org/TR/vc-bitstring-status-list/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                  BitstringStatusList
                </a>{" "}
                for credential revocation — a W3C standard that lets issuers revoke
                credentials without revealing which credentials exist. The revocation
                list is a public bitstring. No phone-home, no tracking, no
                correlation.
              </Principle>

              <Principle title="The credential is the source of truth.">
                Not the server. Not the app. Not the company. The credential is a
                mathematical object that proves its own validity. If KeyWitness
                disappeared tomorrow, every credential we ever issued would still
                verify. That's the point.
              </Principle>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-white mb-4">What We're Building Toward</h2>
            <p>
              A future where every message can optionally carry proof of its origin.
              Not surveillance — the opposite. Proof that empowers the author, not
              the platform. Proof that travels with the content, not in a database.
              Proof that anyone can verify and no one can revoke except the author.
            </p>
            <p className="mt-3">
              We don't need everyone to use KeyWitness. We need everyone to use open
              standards. We need Android keyboards and desktop apps and hardware
              tokens and browser extensions that all speak the same credential
              language. We need a world where "this was typed by a human" is as
              easy to verify as "this website has a valid TLS certificate."
            </p>
            <p className="mt-3">
              The emoji in the URL aren't just an encoding. They're a declaration:
              this message was written by a person — one of the diverse, imperfect,
              irreplaceable humans who still choose to type their own words.
            </p>
          </section>

          <section className="border-t border-gray-800 pt-8 mt-8">
            <div className="text-center">
              <p className="text-gray-500 text-sm">
                Read the{" "}
                <a href="/how" className="text-blue-400 hover:underline">technical details</a>,
                check the{" "}
                <a href="/developers" className="text-blue-400 hover:underline">developer docs</a>,
                or{" "}
                <a href="/" className="text-blue-400 hover:underline">verify an attestation</a>.
              </p>
            </div>
          </section>
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

function Principle({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-l-2 border-gray-700 pl-4">
      <div className="text-white font-medium mb-1">{title}</div>
      <div className="text-gray-400 text-sm">{children}</div>
    </div>
  );
}
