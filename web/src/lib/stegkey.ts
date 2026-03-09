/**
 * Emoji-based AES key encoding using human emoji with skin tones.
 *
 * Encodes a 256-bit AES key into 27 human emoji so it can travel after
 * a `#` in a URL while being visible, on-brand ("human-typed"), and
 * surviving messaging apps like iMessage.
 *
 * Alphabet: 129 Emoji_Modifier_Base characters × 6 variants
 * (default yellow + 5 Fitzpatrick skin tones) = 774 symbols.
 * log2(774) ≈ 9.60 bits/emoji → ceil(256/9.60) = 27 emoji.
 *
 * Encoding: treat the 32-byte key as a big integer, convert to base-774,
 * map each digit to an emoji.
 */

// ── Alphabet ────────────────────────────────────────────────────────────────

const SKIN_TONE_BASES: number[] = [
  0x261D, 0x26F9, 0x270A, 0x270B, 0x270C, 0x270D,
  0x1F385, 0x1F3C2, 0x1F3C3, 0x1F3C4, 0x1F3C7, 0x1F3CA, 0x1F3CB, 0x1F3CC,
  0x1F442, 0x1F443, 0x1F446, 0x1F447, 0x1F448, 0x1F449, 0x1F44A, 0x1F44B,
  0x1F44C, 0x1F44D, 0x1F44E, 0x1F44F, 0x1F450,
  0x1F466, 0x1F467, 0x1F468, 0x1F469, 0x1F46B, 0x1F46C, 0x1F46D, 0x1F46E,
  0x1F470, 0x1F471, 0x1F472, 0x1F473, 0x1F474, 0x1F475, 0x1F476, 0x1F477,
  0x1F478, 0x1F47C,
  0x1F481, 0x1F482, 0x1F483, 0x1F485, 0x1F486, 0x1F487, 0x1F4AA,
  0x1F574, 0x1F575, 0x1F57A, 0x1F590, 0x1F595, 0x1F596,
  0x1F645, 0x1F646, 0x1F647, 0x1F64B, 0x1F64C, 0x1F64D, 0x1F64E, 0x1F64F,
  0x1F6A3, 0x1F6B4, 0x1F6B5, 0x1F6B6, 0x1F6C0, 0x1F6CC,
  0x1F90C, 0x1F90F, 0x1F918, 0x1F919, 0x1F91A, 0x1F91B, 0x1F91C, 0x1F91D,
  0x1F91E, 0x1F91F,
  0x1F926, 0x1F930, 0x1F931, 0x1F932, 0x1F933, 0x1F934, 0x1F935, 0x1F936,
  0x1F937, 0x1F938, 0x1F939, 0x1F93D, 0x1F93E,
  0x1F977, 0x1F9B5, 0x1F9B6, 0x1F9B8, 0x1F9B9, 0x1F9BB,
  0x1F9CD, 0x1F9CE, 0x1F9CF, 0x1F9D1, 0x1F9D2, 0x1F9D3, 0x1F9D4, 0x1F9D5,
  0x1F9D6, 0x1F9D7, 0x1F9D8, 0x1F9D9, 0x1F9DA, 0x1F9DB, 0x1F9DC, 0x1F9DD,
  0x1FAC3, 0x1FAC4, 0x1FAC5,
  0x1FAF0, 0x1FAF1, 0x1FAF2, 0x1FAF3, 0x1FAF4, 0x1FAF5, 0x1FAF6, 0x1FAF7, 0x1FAF8,
];

const SKIN_TONES: (number | null)[] = [null, 0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF];

const EMOJI_COUNT = 27;

// Build alphabet and reverse lookup lazily
let _alphabet: string[] | null = null;
let _lookup: Map<string, number> | null = null;

function getAlphabet(): string[] {
  if (!_alphabet) {
    _alphabet = [];
    for (const base of SKIN_TONE_BASES) {
      for (const tone of SKIN_TONES) {
        _alphabet.push(
          tone
            ? String.fromCodePoint(base) + String.fromCodePoint(tone)
            : String.fromCodePoint(base),
        );
      }
    }
  }
  return _alphabet;
}

function getLookup(): Map<string, number> {
  if (!_lookup) {
    _lookup = new Map();
    const alphabet = getAlphabet();
    for (let i = 0; i < alphabet.length; i++) {
      _lookup.set(alphabet[i], i);
    }
  }
  return _lookup;
}

// ── BigInt ↔ bytes ──────────────────────────────────────────────────────────

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  let val = n;
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(val & 0xFFn);
    val >>= 8n;
  }
  return bytes;
}

// ── Base64url helpers ───────────────────────────────────────────────────────

function base64urlToBytes(input: string): Uint8Array {
  let b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4 !== 0) b64 += "=";
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ── Skin tone detection ─────────────────────────────────────────────────────

const SKIN_TONE_SET = new Set([0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF]);

function isSkinTone(cp: number): boolean {
  return SKIN_TONE_SET.has(cp);
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Encode a base64url AES key into 27 human emoji. */
export function encodeStegKey(base64urlKey: string): string {
  const bytes = base64urlToBytes(base64urlKey);
  const num = bytesToBigInt(bytes);
  const alphabet = getAlphabet();
  const base = BigInt(alphabet.length);

  const digits: number[] = [];
  let val = num;
  for (let i = 0; i < EMOJI_COUNT; i++) {
    digits.push(Number(val % base));
    val /= base;
  }

  return digits.map((d) => alphabet[d]).join("");
}

/** Decode 27 human emoji back to a base64url AES key. Returns null if invalid. */
export function decodeStegKey(encoded: string): string | null {
  const lookup = getLookup();

  // Parse emoji from the string (handles multi-codepoint skin-tone sequences)
  const emojiList: number[] = [];
  const codePoints = [...encoded].map((ch) => ch.codePointAt(0)!);

  let i = 0;
  while (i < codePoints.length) {
    const cp = codePoints[i];
    const nextCp = codePoints[i + 1];

    // Try base + skin tone (2 codepoints → 1 emoji)
    if (nextCp !== undefined && isSkinTone(nextCp)) {
      const emoji = String.fromCodePoint(cp) + String.fromCodePoint(nextCp);
      const idx = lookup.get(emoji);
      if (idx !== undefined) {
        emojiList.push(idx);
        i += 2;
        continue;
      }
    }

    // Try base alone (1 codepoint)
    const emoji = String.fromCodePoint(cp);
    const idx = lookup.get(emoji);
    if (idx !== undefined) {
      emojiList.push(idx);
      i += 1;
      continue;
    }

    // Skip unknown codepoints (e.g. variation selectors)
    i += 1;
  }

  if (emojiList.length !== EMOJI_COUNT) return null;

  const base = BigInt(getAlphabet().length);
  let num = 0n;
  for (let j = emojiList.length - 1; j >= 0; j--) {
    num = num * base + BigInt(emojiList[j]);
  }

  const bytes = bigIntToBytes(num, 32);
  return bytesToBase64url(bytes);
}

/** Check if a string contains emoji from our alphabet. */
export function hasStegKey(s: string): boolean {
  const lookup = getLookup();
  const codePoints = [...s].map((ch) => ch.codePointAt(0)!);

  let count = 0;
  let i = 0;
  while (i < codePoints.length) {
    const cp = codePoints[i];
    const nextCp = codePoints[i + 1];

    if (nextCp !== undefined && isSkinTone(nextCp)) {
      const emoji = String.fromCodePoint(cp) + String.fromCodePoint(nextCp);
      if (lookup.has(emoji)) { count++; i += 2; continue; }
    }

    const emoji = String.fromCodePoint(cp);
    if (lookup.has(emoji)) { count++; i += 1; continue; }

    i += 1;
  }

  return count >= EMOJI_COUNT;
}
