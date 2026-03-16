import { type ReactNode } from "react";
import Nav from "../components/Nav";
import { Section, Stagger } from "../components/ScrollReveal";

// ── Big quote block ──────────────────────────────────────────────────────────

function BigQuote({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-green-500/40 pl-6 my-8">
      <p className="text-2xl sm:text-3xl font-light text-white leading-snug tracking-tight">
        {children}
      </p>
    </div>
  );
}

// ── Principle card ───────────────────────────────────────────────────────────

function Principle({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="group">
      <div className="border border-gray-800 rounded-xl p-6 bg-[#0d0d0d] hover:border-gray-700 transition-colors">
        <div className="text-white font-semibold text-lg mb-2">{title}</div>
        <div className="text-gray-400 text-[15px] leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

// ── Code block ───────────────────────────────────────────────────────────────

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="bg-[#111111] border border-gray-800 rounded-xl p-5 text-sm text-gray-400 overflow-x-auto my-4 font-mono">
      {children}
    </pre>
  );
}

// ── Platform card ────────────────────────────────────────────────────────────

function PlatformCard({ emoji, name, description }: { emoji: string; name: string; description: string }) {
  return (
    <div className="border border-gray-800 rounded-lg p-4 bg-[#0d0d0d] hover:border-gray-700 transition-colors">
      <div className="text-2xl mb-2">{emoji}</div>
      <div className="text-white font-medium text-sm mb-1">{name}</div>
      <div className="text-gray-500 text-xs leading-relaxed">{description}</div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function Manifesto() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />

      {/* Hero — always visible */}
      <div className="min-h-[80vh] flex flex-col items-center justify-center px-6 text-center">
        <Section>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-white mb-6">
            The Humanifesto
          </h1>
        </Section>
        <Section delay={300}>
          <p className="text-gray-500 text-xl sm:text-2xl max-w-lg leading-relaxed">
            On proving human input in the age of AI.
          </p>
        </Section>
        <Section delay={600}>
          <div className="mt-16 text-gray-600 text-sm animate-bounce">
            ↓ scroll
          </div>
        </Section>
      </div>

      <div className="max-w-2xl mx-auto px-6 pb-32 space-y-32">

        {/* ── The Problem ──────────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <BigQuote>
              The default assumption about any text
              is that a machine wrote it.
            </BigQuote>
          </Section>

          <Section delay={100}>
            <p className="text-gray-400 text-lg leading-relaxed">
              Emails, messages, essays, code reviews, love letters — all suspect.
              The tools that generate text are now better at sounding human than
              most humans are at sounding like themselves.
            </p>
          </Section>

          <Section delay={200}>
            <p className="text-gray-400 text-lg leading-relaxed">
              This isn't a technical curiosity. It's an erosion of trust at the
              most fundamental level of human communication.
            </p>
          </Section>

          <Section delay={100}>
            <p className="text-white text-xl font-medium">
              We believe this can be solved — not by detecting AI, but by proving humanity.
            </p>
          </Section>
        </div>

        {/* ── The Approach ─────────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              The Approach
            </h2>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              KeyWitness captures cryptographic proof at the point of input — the keyboard.
              Every keystroke is witnessed: its timing, the finger's position on the glass,
              the contact radius, the pressure.
            </p>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              This data is unique to the typist, unique to the moment, and impossible to
              forge after the fact.
            </p>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              When you seal a message, the keyboard builds a{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                W3C Verifiable Credential
              </a>{" "}
              — a self-contained proof that can be verified by anyone, anywhere, without
              trusting us or any central authority.
            </p>
          </Section>

          <Section>
            <BigQuote>
              The signing key lives in the device's secure hardware.
              The private key never leaves.
            </BigQuote>
          </Section>
        </div>

        {/* ── Principles ───────────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Principles
            </h2>
          </Section>

          <div className="space-y-4">
            <Stagger gap={80}>
              {[
                <Principle title="Prove, don't detect.">
                  AI detection is a statistical guess that degrades over time.
                  Cryptographic proof is mathematical certainty that gets stronger
                  with every independent verification.
                </Principle>,

                <Principle title="The device is the witness, not the server.">
                  The signing key lives in your Secure Enclave. The server never sees
                  the cleartext, the private key, or the decryption key. Verification
                  happens in the recipient's browser. The server is a convenience,
                  not a dependency.
                </Principle>,

                <Principle title="Standards over proprietary formats.">
                  W3C Verifiable Credentials 2.0. eddsa-jcs-2022. did:key. BitstringStatusList.
                  Every piece is an open standard. Any conforming verifier can validate
                  our credentials without knowing we exist.
                </Principle>,

                <Principle title="Self-contained credentials.">
                  A KeyWitness attestation carries everything needed to verify it.
                  No phone-home. No API call. No expiration server. You could verify
                  one on an air-gapped machine with nothing but an Ed25519 library.
                </Principle>,

                <Principle title="Privacy by architecture, not policy.">
                  Cleartext is encrypted with AES-256-GCM. The key lives in the URL fragment,
                  which browsers never send to servers. We can't read what you wrote because
                  we architecturally can't, not because we promise not to.
                </Principle>,
              ]}
            </Stagger>
          </div>
        </div>

        {/* ── Why Emoji ────────────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Why Emoji
            </h2>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              A 256-bit AES encryption key is 43 characters of base64:
            </p>
          </Section>

          <Section>
            <CodeBlock>K7gNU3sdo-OL0wNhqoVWhr3g6s1xYv72ol_pe_Unols</CodeBlock>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              That string needs to travel with the link. It can't go to the server (privacy).
              It can't be invisible (messaging apps strip invisible characters). It needs to
              survive copy-paste across every platform humans share links.
            </p>
          </Section>

          <Section>
            <p className="text-white text-xl font-medium">
              We encode it as 27 human emoji.
            </p>
          </Section>

          <Section>
            <CodeBlock>typed.by/magicseth/42#👵🏽🤳🤰🏾💁🏻🦹🏽✋🏾👂✋🏼🏊👨🏻💁🏽🧓🏼🧜🏼🫸🏽✍🧝🏼🏋🏼🤏🏻🚵🏿🧒🏻🏂🏿🤜🏻🚴🏻🫴🏽🖖🏽✊🏽</CodeBlock>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              Unicode defines 129 emoji that support Fitzpatrick skin tone modifiers.
              Each has 6 visual variants. That's an alphabet of 774 symbols —
              each carrying log<sub>2</sub>(774) ≈ 9.6 bits. 27 emoji for 256 bits.
            </p>
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stagger gap={60}>
              {[
                <div className="border border-gray-800 rounded-lg p-4 bg-[#0d0d0d]">
                  <div className="text-white font-medium mb-1">Human</div>
                  <div className="text-gray-500 text-sm">The key that protects the message is literally composed of people.</div>
                </div>,
                <div className="border border-gray-800 rounded-lg p-4 bg-[#0d0d0d]">
                  <div className="text-white font-medium mb-1">Diverse</div>
                  <div className="text-gray-500 text-sm">Skin tone modifiers represent real human diversity in the cryptography itself.</div>
                </div>,
                <div className="border border-gray-800 rounded-lg p-4 bg-[#0d0d0d]">
                  <div className="text-white font-medium mb-1">Resilient</div>
                  <div className="text-gray-500 text-sm">Every platform renders emoji. Every clipboard copies them. They survive everything.</div>
                </div>,
                <div className="border border-gray-800 rounded-lg p-4 bg-[#0d0d0d]">
                  <div className="text-white font-medium mb-1">Dense</div>
                  <div className="text-gray-500 text-sm">27 emoji for 256 bits. A hex string would be 64 characters. QR codes are larger.</div>
                </div>,
              ]}
            </Stagger>
          </div>
        </div>

        {/* ── Build Your Own ───────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Build Your Own
            </h2>
          </Section>

          <Section>
            <BigQuote>
              We want this to be an ecosystem, not a product.
            </BigQuote>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              Use{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                W3C Verifiable Credentials 2.0
              </a>{" "}
              and{" "}
              <a href="https://w3c-ccg.github.io/did-method-key/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                did:key
              </a>{" "}
              for issuer identity. Then capture whatever your platform gives you:
            </p>
          </Section>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stagger gap={60}>
              {[
                <PlatformCard emoji="📱" name="Android" description="InputMethodService + Play Integrity" />,
                <PlatformCard emoji="🖥" name="Desktop" description="Keystroke timing via OS input hooks" />,
                <PlatformCard emoji="⌨️" name="Hardware" description="Secure element signs at the hardware level" />,
                <PlatformCard emoji="🌐" name="Browser" description="WebAuthn + DOM keystroke events" />,
                <PlatformCard emoji="🎙" name="Voice" description="Audio spectrograms + speaker verification" />,
                <PlatformCard emoji="📷" name="Camera" description="Unfiltered capture with device attestation" />,
              ]}
            </Stagger>
          </div>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              The proof chain is extensible. The credential format accommodates multiple
              independent proofs in a single document. Publish your context at{" "}
              <code className="bg-[#1a1a1a] px-1.5 py-0.5 rounded text-green-400 text-xs">.well-known/keywitness-providers.json</code>{" "}
              so others can discover what you support.
            </p>
          </Section>
        </div>

        {/* ── Together ─────────────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Together
            </h2>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              If your Android keyboard produces W3C VCs with eddsa-jcs-2022, our verifier
              validates them. If our iOS keyboard produces a credential, your verifier
              validates it. No partnership required. No API key. The math is the agreement.
            </p>
          </Section>

          <div className="space-y-4">
            <Stagger gap={80}>
              {[
                <Principle title="Trust registries, not gatekeepers.">
                  A trust registry provides discovery, not permission. Anyone can publish one.
                  Anyone can subscribe to multiple. The user decides who they trust.
                </Principle>,

                <Principle title="Revocation without control.">
                  <a href="https://www.w3.org/TR/vc-bitstring-status-list/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                    BitstringStatusList
                  </a>{" "}
                  lets issuers revoke credentials without revealing which credentials exist.
                  No phone-home, no tracking, no correlation.
                </Principle>,

                <Principle title="The credential is the source of truth.">
                  Not the server. Not the app. Not the company. If KeyWitness disappeared
                  tomorrow, every credential we ever issued would still verify.
                </Principle>,
              ]}
            </Stagger>
          </div>
        </div>

        {/* ── Closing ──────────────────────────────────────────────── */}

        <div className="space-y-8">
          <Section>
            <BigQuote>
              We need a world where "this was typed by a human" is as easy to verify
              as "this website has a valid TLS certificate."
            </BigQuote>
          </Section>

          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              The emoji in the URL aren't just an encoding. They're a declaration:
              this message was written by a person — one of the diverse, imperfect,
              irreplaceable humans who still choose to type their own words.
            </p>
          </Section>
        </div>

        {/* ── Footer links ─────────────────────────────────────────── */}

        <Section>
          <div className="border-t border-gray-800 pt-12 text-center space-y-4">
            <div className="flex items-center justify-center gap-6 text-sm">
              <a href="/how" className="text-gray-500 hover:text-white transition-colors">How It Works</a>
              <span className="text-gray-800">·</span>
              <a href="/developers" className="text-gray-500 hover:text-white transition-colors">Developers</a>
              <span className="text-gray-800">·</span>
              <a href="/" className="text-gray-500 hover:text-white transition-colors">Verify</a>
              <span className="text-gray-800">·</span>
              <a href="https://github.com/magicseth/keywitness" className="text-gray-500 hover:text-white transition-colors" target="_blank" rel="noopener">GitHub</a>
            </div>
            <p className="text-gray-700 text-xs">keywitness.io</p>
          </div>
        </Section>
      </div>
    </div>
  );
}
