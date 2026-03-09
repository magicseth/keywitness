import Nav from "../components/Nav";

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-100">
      <Nav />

      {/* Docco-style two-column layout for the whole page */}
      <div className="border-b border-gray-800">

        {/* Title row */}
        <Row
          left={
            <>
              <h1 className="text-3xl font-bold tracking-tight text-white mb-3">
                How It Works
              </h1>
              <p className="text-gray-400 leading-relaxed">
                You type a message. You tap Seal. The keyboard proves it was
                you, on your phone, typing with your fingers. Then anyone can
                check that proof — without trusting us or anyone else.
              </p>
            </>
          }
        />

        {/* 1. Type */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">You type normally.</h2>
              <p>
                KeyWitness is a keyboard. You install it, switch to it, and type
                like you always do. While you type, the keyboard quietly records
                how you type — the rhythm, the pauses between keys, where your
                finger lands, how hard you press.
              </p>
              <p className="mt-3">
                Nobody types the same way. Your pattern is as unique as your
                handwriting. That's the signal.
              </p>
            </>
          }
          right={
            <>
              Each keystroke event captures: key-down time, key-up time, x/y
              touch coordinates, contact radius (finger area), and force. All
              times are <code>ProcessInfo.systemUptime</code> with
              sub-millisecond precision. Data stays in memory until you seal or
              dismiss.
            </>
          }
        />

        {/* 2. Seal */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">You tap Seal.</h2>
              <p>
                When you're done, you tap the Seal button. The keyboard takes
                everything — your text, your typing pattern — and locks it into
                a signed document. It's like a notarized statement: "This text
                was typed by this device, at this time, with these fingers."
              </p>
              <p className="mt-3">
                The signing key lives inside your phone's secure hardware. It
                never leaves. Not even we can extract it.
              </p>
            </>
          }
          right={
            <>
              The keyboard builds a{" "}
              <a href="https://www.w3.org/TR/vc-data-model-2.0/" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                W3C Verifiable Credential 2.0
              </a>{" "}
              and signs it with <code>eddsa-jcs-2022</code> (Ed25519 over{" "}
              <a href="https://www.rfc-editor.org/rfc/rfc8785" className="text-blue-400 hover:underline" target="_blank" rel="noopener">
                RFC 8785
              </a>{" "}
              JCS-canonicalized JSON). The issuer is a{" "}
              <code>did:key</code> — the public key itself, no registry needed.
              The credential includes SHA-256 hashes of both the cleartext and
              the keystroke biometrics.
            </>
          }
        />

        {/* 3. Encrypt */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">We can't read what you wrote.</h2>
              <p>
                Before anything leaves your phone, the text is encrypted with a
                random key. That key is never sent to our server. It's encoded
                as 27 emoji and tucked into the link you share.
              </p>
              <p className="mt-3">
                The server stores an encrypted blob it can't decrypt. We
                couldn't read your messages even if we wanted to. That's not a
                policy — it's math.
              </p>
            </>
          }
          right={
            <>
              AES-256-GCM with a random 256-bit key. The key is placed in the
              URL fragment (<code>#</code>), which browsers never send to
              servers per RFC 3986. The key is encoded as 27 emoji using a
              base-774 alphabet (129 Emoji_Modifier_Base × 6 Fitzpatrick skin
              tones). Example:{" "}
              <span className="break-all">typed.by/you/42#👵🏽🤳🤰🏾💁🏻🦹🏽✋🏾👂✋🏼🏊</span>
            </>
          }
        />

        {/* 4. Real device */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">It was a real iPhone.</h2>
              <p>
                Your iPhone has a chip that Apple locked down at the factory.
                When KeyWitness installs, Apple certifies that this is a real,
                unmodified phone running the real app — not a computer
                pretending to be one.
              </p>
              <p className="mt-3">
                So when someone sees "device verified" on your seal, it means
                Apple vouched for the hardware.
              </p>
            </>
          }
          right={
            <>
              Apple's{" "}
              <code>DCAppAttestService</code> generates a P-256 ECDSA key pair
              in the Secure Enclave. The attestation is a CBOR-encoded
              certificate chain rooted at Apple's App Attest CA. At
              registration, the server links the App Attest credential to the
              keyboard's Ed25519 signing key. Subsequent verification is a
              credential existence check — no per-request assertion needed.
            </>
          }
        />

        {/* 5. Same person */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">It was the same person as before.</h2>
              <p>
                Every message you seal is signed with the same key — your
                device's unique identity. If someone trusted a previous seal
                from you, they know this one came from the same phone.
              </p>
              <p className="mt-3">
                Claim a username and your seals get short, memorable links:{" "}
                <code className="text-green-400">typed.by/magicseth/1</code>,{" "}
                <code className="text-green-400">typed.by/magicseth/2</code>,
                and so on.
              </p>
            </>
          }
          right={
            <>
              The Ed25519 public key is encoded as a self-resolving{" "}
              <code>did:key:z6Mk...</code> (multicodec <code>0xed01</code> +
              base58btc). Usernames are bound to the public key — first come,
              first served, no password. A recovery email is stored for key
              loss. Multiple devices can rotate keys under one username.
            </>
          }
        />

        {/* 6. Face ID */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">The owner of the phone said yes.</h2>
              <p>
                After you seal a message, your phone asks you to confirm with
                Face ID. This is optional but powerful: it proves the person
                whose face unlocks the phone saw this exact message and approved
                it.
              </p>
              <p className="mt-3">
                Not just the device. The person.
              </p>
            </>
          }
          right={
            <>
              Face ID via <code>LocalAuthentication</code> (LAContext). On
              success, the app signs <code>shortId + cleartextHash</code> with
              the same Ed25519 key and uploads via PATCH. The server verifies
              the signer matches the original attestation signer — a different
              key cannot claim someone else's biometric.
            </>
          }
        />

        {/* 7. Verify */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">Anyone can check. No trust required.</h2>
              <p>
                Click the link. Your browser does the math. It checks every
                signature, every hash, every proof — right there on your
                machine. No server call. No API key. No account.
              </p>
              <p className="mt-3">
                If KeyWitness disappeared tomorrow, every seal we ever issued
                would still verify. That's the whole point.
              </p>
            </>
          }
          right={
            <>
              Client-side verification uses <code>tweetnacl</code> for Ed25519
              and Web Crypto for SHA-256 / AES-256-GCM. The{" "}
              <code>did:key</code> is decoded to get the raw public key. JCS
              canonicalization is re-applied, the signature is verified, and{" "}
              <code>cleartextHash</code> is compared. If the emoji fragment is
              present, AES-GCM decrypts the cleartext and keystroke data.
            </>
          }
        />

        {/* What it doesn't prove */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">What this doesn't prove.</h2>
              <p>
                KeyWitness proves the text was typed by a human on a specific
                device. It does not prove who that human is (only that it's the
                same device each time), that they typed voluntarily, or that
                nobody told them what to type.
              </p>
              <p className="mt-3">
                It's proof of authorship, not proof of intent.
              </p>
            </>
          }
          right={
            <>
              The credential proves: device identity (signing key), device
              authenticity (App Attest), content integrity (SHA-256), temporal
              ordering (timestamps), human input patterns (biometrics hash),
              and optionally owner confirmation (Face ID). It does not prove
              identity beyond the device, voluntariness, or originality of
              thought.
            </>
          }
        />

        {/* Open standard */}
        <Row
          left={
            <>
              <h2 className="text-white font-semibold text-lg mb-2">It's all open standards.</h2>
              <p>
                Everything we use — the credential format, the signatures, the
                identifiers — is a published standard anyone can implement. An
                Android keyboard, a desktop app, or a hardware token could
                produce seals that our verifier accepts, and vice versa.
              </p>
              <p className="mt-3">
                Read the{" "}
                <a href="/manifesto" className="text-blue-400 hover:underline">Humanifesto</a>{" "}
                for how to build your own, or check the{" "}
                <a href="/developers" className="text-blue-400 hover:underline">developer docs</a>{" "}
                to integrate verification.
              </p>
            </>
          }
          right={
            <>
              W3C Verifiable Credentials 2.0, eddsa-jcs-2022 (Ed25519 + JCS),
              did:key identifiers, BitstringStatusList for revocation. JSON-LD
              context published at{" "}
              <a href="/ns/v1" className="text-blue-400 hover:underline">keywitness.io/ns/v1</a>.
              Provider capabilities at{" "}
              <a href="/.well-known/keywitness-providers.json" className="text-blue-400 hover:underline">
                .well-known/keywitness-providers.json
              </a>.
            </>
          }
        />
      </div>

      <footer className="text-center text-gray-600 text-xs py-8">
        <a href="/" className="hover:text-gray-400 transition-colors">
          keywitness.io
        </a>
      </footer>
    </div>
  );
}

function Row({
  left,
  right,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 border-t border-gray-800">
      <div className="px-6 py-8 lg:pr-10 text-[15px] text-gray-400 leading-relaxed">
        {left}
      </div>
      {right ? (
        <div className="bg-[#111113] px-6 py-8 lg:border-l border-t lg:border-t-0 border-gray-800 text-xs text-gray-500 leading-relaxed font-mono">
          {right}
        </div>
      ) : (
        <div className="hidden lg:block bg-[#111113] lg:border-l border-gray-800" />
      )}
    </div>
  );
}
