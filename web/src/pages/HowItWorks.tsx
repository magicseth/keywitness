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
                You type a message. You tap Seal. The keyboard signs it
                with a key locked in your phone's hardware. Anyone can
                check the signature without trusting us.
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
                KeyWitness replaces your keyboard. While you type, it records
                each keystroke: when you pressed, when you released, where
                your finger landed, how hard you pressed. This data proves
                a physical human was tapping glass, not a script generating text.
              </p>
              <p className="mt-3">
                The biometrics don't identify you. They prove someone was
                physically typing.
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
                The keyboard hashes the keystroke data, bundles it with
                your text, and signs the whole thing with an Ed25519 key
                stored in the Secure Enclave. The result is a W3C
                Verifiable Credential.
              </p>
              <p className="mt-3">
                The signing key lives in hardware. It cannot be extracted,
                copied, or used by another app.
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
              <h2 className="text-white font-semibold text-lg mb-2">The text is encrypted on your phone.</h2>
              <p>
                Before upload, the text is encrypted with a random 256-bit
                AES key. That key goes into the URL fragment (the part after #),
                which browsers never send to servers. The server stores
                ciphertext it cannot decrypt.
              </p>
              <p className="mt-3">
                The key is encoded as 27 human emoji so it survives
                copy-paste across messaging apps.
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
              <h2 className="text-white font-semibold text-lg mb-2">Apple verifies the device.</h2>
              <p>
                App Attest generates a separate P-256 key in the Secure
                Enclave and has Apple sign a certificate for it. This
                certificate proves the app is running on a real, unmodified
                iPhone.
              </p>
              <p className="mt-3">
                "Device verified" means Apple's certificate chain checks out,
                not just that we say so.
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
              <h2 className="text-white font-semibold text-lg mb-2">Same key, every time.</h2>
              <p>
                Every seal from your device uses the same Ed25519 key.
                If a verifier trusted one seal, they can confirm the next
                one came from the same device.
              </p>
              <p className="mt-3">
                Claim a username for short links:{" "}
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
              <h2 className="text-white font-semibold text-lg mb-2">Face ID confirms the owner. (Optional.)</h2>
              <p>
                After sealing, the app can prompt Face ID. If it passes,
                a second signature is added proving the person whose face
                unlocks this phone saw the message and approved it.
              </p>
              <p className="mt-3">
                This step is optional. Seals work without it.
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
              <h2 className="text-white font-semibold text-lg mb-2">Anyone can verify.</h2>
              <p>
                Open the link. The browser checks the Ed25519 signature,
                the SHA-256 hashes, and the App Attest certificate chain.
                All client-side. No server call, no account, no API key.
              </p>
              <p className="mt-3">
                The credential is self-contained. It would still verify
                if our server went offline.
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
                It's proof of human input, not proof of identity or intent.
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
              <h2 className="text-white font-semibold text-lg mb-2">Open standards throughout.</h2>
              <p>
                The credential format, signatures, and identifiers are all
                published standards. An Android keyboard or hardware token
                could produce seals our verifier accepts, and vice versa.
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
