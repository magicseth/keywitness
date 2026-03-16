import { useState, useEffect, type ReactNode } from "react";
import Nav from "../components/Nav";
import { Section, Stagger } from "../components/ScrollReveal";

// ── Typing animation ─────────────────────────────────────────────────────────

function TypingDemo() {
  const fullText = "This was typed by a human.";
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<"typing" | "sealing" | "done">("typing");
  const [cursorVisible, setCursorVisible] = useState(true);

  useEffect(() => {
    const blink = setInterval(() => setCursorVisible((v) => !v), 530);
    return () => clearInterval(blink);
  }, []);

  useEffect(() => {
    if (phase !== "typing") return;
    if (typed.length >= fullText.length) {
      setTimeout(() => setPhase("sealing"), 600);
      return;
    }
    const delay = 40 + Math.random() * 80;
    const timer = setTimeout(() => setTyped(fullText.slice(0, typed.length + 1)), delay);
    return () => clearTimeout(timer);
  }, [typed, phase]);

  useEffect(() => {
    if (phase !== "sealing") return;
    const timer = setTimeout(() => setPhase("done"), 1200);
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Phone frame */}
      <div className="bg-[#111] border border-gray-800 rounded-2xl p-6 shadow-2xl">
        {/* Message area */}
        <div className="bg-[#0a0a0a] rounded-lg p-4 min-h-[60px] mb-4 border border-gray-800/50">
          <span className="text-white text-lg font-light">
            {typed}
            {phase === "typing" && (
              <span className={`inline-block w-[2px] h-5 bg-blue-400 ml-0.5 align-text-bottom ${cursorVisible ? "opacity-100" : "opacity-0"}`} />
            )}
          </span>
        </div>

        {/* Seal button */}
        <div className="flex justify-center">
          {phase === "typing" && (
            <div className="px-6 py-2.5 rounded-full bg-gray-800 text-gray-500 text-sm font-medium">
              Seal
            </div>
          )}
          {phase === "sealing" && (
            <div className="px-6 py-2.5 rounded-full bg-blue-600 text-white text-sm font-medium animate-pulse">
              Sealing...
            </div>
          )}
          {phase === "done" && (
            <div className="px-6 py-2.5 rounded-full bg-green-600 text-white text-sm font-medium flex items-center gap-2">
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Sealed
            </div>
          )}
        </div>

        {/* Link appears after sealing */}
        {phase === "done" && (
          <div className="mt-4 text-center animate-fade-in">
            <div className="text-xs text-gray-500 mb-1">Proof link created</div>
            <div className="text-blue-400 text-sm font-mono break-all">
              keywitness.io/v/Kx8mP2qR4t#👵🏽🤳🤰🏾💁🏻🦹🏽✋🏾
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Step card ────────────────────────────────────────────────────────────────

function Step({ number, title, description, icon }: { number: number; title: string; description: string; icon: ReactNode }) {
  return (
    <div className="flex gap-5">
      <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#111] border border-gray-800 flex items-center justify-center text-2xl">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-gray-600 text-sm font-mono">{String(number).padStart(2, "0")}</span>
          <h3 className="text-white font-semibold text-lg">{title}</h3>
        </div>
        <p className="text-gray-400 text-[15px] leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ── Trust chain node ─────────────────────────────────────────────────────────

function TrustNode({ label, detail, last }: { label: string; detail: string; last?: boolean }) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex flex-col items-center">
        <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-400/30 shadow-[0_0_8px_rgba(34,197,94,0.3)]" />
        {!last && <div className="w-px h-12 bg-gradient-to-b from-green-500/50 to-green-500/10" />}
      </div>
      <div className="pb-6">
        <div className="text-white font-medium">{label}</div>
        <div className="text-gray-500 text-sm">{detail}</div>
      </div>
    </div>
  );
}

// ── Feature card ─────────────────────────────────────────────────────────────

function FeatureCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="border border-gray-800 rounded-xl p-5 bg-[#0d0d0d] hover:border-gray-700 transition-colors">
      <div className="text-white font-semibold mb-1.5">{title}</div>
      <div className="text-gray-500 text-sm leading-relaxed">{description}</div>
    </div>
  );
}

// ── Main landing page ────────────────────────────────────────────────────────

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />

      {/* ── Hero ────────────────────────────────────────────────── */}
      <div className="min-h-[90vh] flex flex-col items-center justify-center px-6">
        <Section>
          <h1 className="text-5xl sm:text-7xl font-bold tracking-tight text-white text-center mb-4">
            Prove you wrote it.
          </h1>
        </Section>
        <Section delay={200}>
          <p className="text-gray-500 text-lg sm:text-xl text-center max-w-lg leading-relaxed mb-12">
            Cryptographic proof that text was typed by a real person on a real device.
            Verifiable by anyone. No trust required.
          </p>
        </Section>
        <Section delay={400}>
          <TypingDemo />
        </Section>
        <Section delay={800}>
          <div className="mt-16 text-gray-700 text-sm animate-bounce">↓</div>
        </Section>
      </div>

      <div className="max-w-2xl mx-auto px-6 pb-32 space-y-40">

        {/* ── The Problem ──────────────────────────────────────── */}
        <div className="space-y-8">
          <Section>
            <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight leading-snug">
              AI killed trust in text.
            </p>
          </Section>
          <Section>
            <p className="text-gray-400 text-lg leading-relaxed">
              Every email, every message, every essay is suspect. AI writes better
              prose than most people. Detection is a losing arms race — statistical
              guesses that degrade with every model release.
            </p>
          </Section>
          <Section>
            <div className="border-l-2 border-green-500/40 pl-6">
              <p className="text-2xl sm:text-3xl font-light text-white leading-snug">
                We don't detect AI.<br />
                We prove humanity.
              </p>
            </div>
          </Section>
        </div>

        {/* ── How It Works ─────────────────────────────────────── */}
        <div className="space-y-10">
          <Section>
            <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Four steps. Zero trust.
            </p>
          </Section>

          <div className="space-y-8">
            <Stagger gap={100}>
              {[
                <Step
                  number={1}
                  title="Type"
                  icon="⌨️"
                  description="You type on the KeyWitness keyboard. It captures your unique rhythm — timing, position, pressure. A biometric fingerprint of the moment."
                />,
                <Step
                  number={2}
                  title="Seal"
                  icon="🔏"
                  description="Tap Seal. The keyboard signs the message with a key locked in the device's Secure Enclave and builds a W3C Verifiable Credential."
                />,
                <Step
                  number={3}
                  title="Share"
                  icon="🔗"
                  description="A link is created. The text is encrypted — even the server can't read it. The decryption key hides in the URL as emoji."
                />,
                <Step
                  number={4}
                  title="Verify"
                  icon="✅"
                  description="Anyone clicks the link. Their browser checks every signature, every hash, every proof — no server, no API, no trust required."
                />,
              ]}
            </Stagger>
          </div>
        </div>

        {/* ── Trust Chain ──────────────────────────────────────── */}
        <div className="space-y-10">
          <Section>
            <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              The trust chain.
            </p>
          </Section>
          <Section>
            <p className="text-gray-400 text-lg leading-relaxed mb-8">
              Five independent proofs, each verifiable on its own.
              Together they make forgery computationally impossible.
            </p>
          </Section>
          <Section>
            <div className="bg-[#0d0d0d] border border-gray-800 rounded-2xl p-8">
              <TrustNode
                label="Secure Enclave"
                detail="Ed25519 signing key generated in hardware. Private key never leaves the chip."
              />
              <TrustNode
                label="Keystroke Biometrics"
                detail="Timing, position, pressure, radius — hashed into the credential."
              />
              <TrustNode
                label="Apple App Attest"
                detail="Apple certifies: real device, real app, not jailbroken."
              />
              <TrustNode
                label="Face ID"
                detail="The phone's owner saw this exact message and approved it."
              />
              <TrustNode
                label="W3C Verifiable Credential"
                detail="Open standard. Self-contained. Verify offline. No phone-home."
                last
              />
            </div>
          </Section>
        </div>

        {/* ── What Makes It Different ──────────────────────────── */}
        <div className="space-y-8">
          <Section>
            <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
              Not like the others.
            </p>
          </Section>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Stagger gap={60}>
              {[
                <FeatureCard
                  title="Proof, not detection"
                  description="AI detectors guess. We prove. Cryptographic certainty that gets stronger with every verification."
                />,
                <FeatureCard
                  title="Privacy by math"
                  description="AES-256-GCM encryption. Key in the URL fragment. The server literally cannot read what you wrote."
                />,
                <FeatureCard
                  title="Open standards"
                  description="W3C VC 2.0, did:key, eddsa-jcs-2022. Any conforming verifier works. No vendor lock-in."
                />,
                <FeatureCard
                  title="Self-contained"
                  description="The credential carries everything. Verify on an air-gapped machine. If we disappear, your proofs still work."
                />,
              ]}
            </Stagger>
          </div>
        </div>

        {/* ── CTA ──────────────────────────────────────────────── */}
        <div className="space-y-8">
          <Section>
            <div className="text-center">
              <p className="text-3xl sm:text-4xl font-bold text-white tracking-tight mb-4">
                Try it.
              </p>
              <p className="text-gray-500 text-lg mb-10">
                Get the iOS keyboard or verify someone else's seal.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <a
                  href="https://x.com/magicseth"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-8 py-3.5 bg-white text-black font-semibold rounded-xl hover:bg-gray-200 transition-colors text-sm"
                >
                  Get TestFlight Access
                </a>
                <a
                  href="/verify"
                  className="px-8 py-3.5 bg-[#111] border border-gray-700 text-white font-semibold rounded-xl hover:border-gray-500 transition-colors text-sm"
                >
                  Verify a Seal
                </a>
              </div>
              <p className="text-gray-600 text-xs mt-4">
                DM <a href="https://x.com/magicseth" className="text-gray-500 hover:text-gray-400" target="_blank" rel="noopener noreferrer">@magicseth</a> on X with "I'm a human" for an invite.
              </p>
            </div>
          </Section>
        </div>

        {/* ── Open Source ──────────────────────────────────────── */}
        <Section>
          <div className="border border-gray-800 rounded-2xl p-8 bg-[#0d0d0d] text-center">
            <p className="text-white font-semibold text-lg mb-2">Open source. Open standards. Open ecosystem.</p>
            <p className="text-gray-500 text-sm mb-6">
              We want this to be an ecosystem, not a product. Build your own on any platform.
            </p>
            <div className="flex items-center justify-center gap-4">
              <a
                href="https://github.com/magicseth/keywitness"
                target="_blank"
                rel="noopener noreferrer"
                className="px-5 py-2.5 bg-[#111] border border-gray-700 text-white font-medium rounded-lg hover:border-gray-500 transition-colors text-sm"
              >
                GitHub
              </a>
              <a
                href="/manifesto"
                className="px-5 py-2.5 text-gray-400 hover:text-white font-medium transition-colors text-sm"
              >
                Read the Humanifesto
              </a>
            </div>
          </div>
        </Section>

        {/* ── Footer ───────────────────────────────────────────── */}
        <Section>
          <div className="border-t border-gray-800 pt-12 text-center space-y-4">
            <div className="flex items-center justify-center gap-6 text-sm">
              <a href="/verify" className="text-gray-500 hover:text-white transition-colors">Verify</a>
              <span className="text-gray-800">·</span>
              <a href="/manifesto" className="text-gray-500 hover:text-white transition-colors">Humanifesto</a>
              <span className="text-gray-800">·</span>
              <a href="/how" className="text-gray-500 hover:text-white transition-colors">How It Works</a>
              <span className="text-gray-800">·</span>
              <a href="/developers" className="text-gray-500 hover:text-white transition-colors">Developers</a>
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
