import Foundation

/// did:key encoding for Ed25519 public keys.
///
/// Format: did:key:z<base58btc(0xed01 || raw_public_key)>
///
/// Uses base58btc encoding (Bitcoin alphabet).
enum DIDKey {

    // MARK: - Public API

    /// Encode an Ed25519 public key (32 bytes) as a did:key identifier.
    static func ed25519ToDIDKey(_ publicKey: Data) -> String {
        precondition(publicKey.count == 32, "Ed25519 public key must be 32 bytes")
        var prefixed = Data([0xed, 0x01])
        prefixed.append(publicKey)
        return "did:key:z\(Base58.encode(prefixed))"
    }

    /// Build the verification method ID: did:key:z...#z...
    static func verificationMethodId(for did: String) -> String {
        let fragment = String(did.dropFirst("did:key:".count))
        return "\(did)#\(fragment)"
    }
}

// MARK: - Base58 (Bitcoin alphabet)

/// Minimal Base58 implementation using the Bitcoin alphabet.
/// Used for multibase 'z' prefix encoding in did:key identifiers.
enum Base58 {

    private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    /// Encode raw bytes to base58btc string.
    static func encode(_ data: Data) -> String {
        var bytes = [UInt8](data)

        // Count leading zeros
        var leadingZeros = 0
        for byte in bytes {
            if byte == 0 { leadingZeros += 1 }
            else { break }
        }

        // Convert to base58
        var result: [Character] = []
        while !bytes.isEmpty {
            var carry = 0
            var newBytes: [UInt8] = []
            for byte in bytes {
                carry = carry * 256 + Int(byte)
                if !newBytes.isEmpty || carry / 58 > 0 {
                    newBytes.append(UInt8(carry / 58))
                }
                carry = carry % 58
            }
            result.append(alphabet[carry])
            bytes = newBytes
        }

        // Add leading '1's for each leading zero byte
        for _ in 0..<leadingZeros {
            result.append(alphabet[0])
        }

        return String(result.reversed())
    }

    /// Decode a base58btc string to raw bytes.
    static func decode(_ string: String) -> Data? {
        let chars = Array(string)
        var result: [UInt8] = []

        // Count leading '1's (maps to 0x00 bytes)
        var leadingOnes = 0
        for char in chars {
            if char == alphabet[0] { leadingOnes += 1 }
            else { break }
        }

        for char in chars {
            guard let index = alphabet.firstIndex(of: char) else {
                return nil // Invalid character
            }
            var carry = index
            for i in stride(from: result.count - 1, through: 0, by: -1) {
                carry += Int(result[i]) * 58
                result[i] = UInt8(carry & 0xFF)
                carry >>= 8
            }
            while carry > 0 {
                result.insert(UInt8(carry & 0xFF), at: 0)
                carry >>= 8
            }
        }

        // Prepend zero bytes for leading '1's
        let zeros = [UInt8](repeating: 0, count: leadingOnes)
        return Data(zeros + result)
    }
}
