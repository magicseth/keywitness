import Foundation

/// Encodes a base64url AES-256 key into 27 human emoji (skin-tone variants).
///
/// Alphabet: 129 Emoji_Modifier_Base × 6 skin tones = 774 symbols.
/// log2(774) ≈ 9.60 bits/emoji → ceil(256/9.60) = 27 emoji.
///
/// Encoding: treat the 32-byte key as a big integer, convert to base-774,
/// map each digit to an emoji from the alphabet.
enum EmojiKey {

    // MARK: - Constants

    private static let emojiCount = 27

    private static let skinToneBases: [UInt32] = [
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
    ]

    private static let skinTones: [UInt32?] = [nil, 0x1F3FB, 0x1F3FC, 0x1F3FD, 0x1F3FE, 0x1F3FF]

    // MARK: - Alphabet (lazy)

    private static let alphabet: [String] = {
        var result: [String] = []
        for base in skinToneBases {
            guard let baseScalar = Unicode.Scalar(base) else { continue }
            for tone in skinTones {
                if let tone = tone, let toneScalar = Unicode.Scalar(tone) {
                    result.append(String(baseScalar) + String(toneScalar))
                } else {
                    result.append(String(baseScalar))
                }
            }
        }
        return result
    }()

    // MARK: - Base64url → bytes

    private static func base64urlToBytes(_ input: String) -> Data? {
        var b64 = input
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        return Data(base64Encoded: b64)
    }

    // MARK: - Big integer arithmetic (using [UInt8] little-endian)

    /// Divide a big-endian byte array by `divisor`, returning (quotient, remainder).
    private static func divmod(_ bytes: [UInt8], by divisor: UInt) -> (quotient: [UInt8], remainder: UInt) {
        var remainder: UInt = 0
        var quotient = [UInt8](repeating: 0, count: bytes.count)
        for i in 0..<bytes.count {
            let value = remainder * 256 + UInt(bytes[i])
            quotient[i] = UInt8(value / divisor)
            remainder = value % divisor
        }
        // Strip leading zeros
        let first = quotient.firstIndex(where: { $0 != 0 }) ?? quotient.endIndex
        quotient = Array(quotient[first...])
        return (quotient, remainder)
    }

    // MARK: - Encode

    /// Encode a base64url AES key string into 27 human emoji.
    static func encode(_ base64urlKey: String) -> String? {
        guard let data = base64urlToBytes(base64urlKey) else { return nil }

        let base = UInt(alphabet.count)
        var bytes = Array(data) // big-endian
        var digits: [Int] = []

        for _ in 0..<emojiCount {
            let (q, r) = divmod(bytes, by: base)
            digits.append(Int(r))
            bytes = q
        }

        return digits.map { alphabet[$0] }.joined()
    }
}
