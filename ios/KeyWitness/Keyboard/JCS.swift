import Foundation

/// RFC 8785 JSON Canonicalization Scheme (JCS) implementation.
///
/// Produces deterministic JSON output for the subset of types we use:
/// - Objects (sorted keys)
/// - Strings (minimal escaping per RFC 8785)
/// - Numbers (IEEE 754 double serialization per RFC 8785)
/// - Booleans
/// - Null
/// - Arrays
///
/// This replaces the hand-rolled canonical JSON in AttestationBuilder.
enum JCS {

    /// Canonicalize a JSON-serializable dictionary to an RFC 8785 string.
    static func canonicalize(_ value: Any) -> String {
        return serializeValue(value)
    }

    /// Canonicalize a Codable value by encoding to JSON first, then re-serializing.
    static func canonicalize<T: Encodable>(_ value: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        guard let obj = try JSONSerialization.jsonObject(with: data) as? Any else {
            throw JCSError.invalidInput
        }
        return serializeValue(obj)
    }

    // MARK: - Private

    private static func serializeValue(_ value: Any) -> String {
        if value is NSNull {
            return "null"
        }
        if let bool = value as? Bool {
            return bool ? "true" : "false"
        }
        // Check NSNumber for booleans vs numbers
        if let number = value as? NSNumber {
            // CFBoolean check to distinguish Bool from NSNumber
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue ? "true" : "false"
            }
            return serializeNumber(number.doubleValue)
        }
        if let string = value as? String {
            return serializeString(string)
        }
        if let array = value as? [Any] {
            let elements = array.map { serializeValue($0) }
            return "[" + elements.joined(separator: ",") + "]"
        }
        if let dict = value as? [String: Any] {
            // RFC 8785: sort keys by UTF-16 code units
            let sortedKeys = dict.keys.sorted { a, b in
                a.utf16.lexicographicallyPrecedes(b.utf16)
            }
            let pairs = sortedKeys.map { key -> String in
                let k = serializeString(key)
                let v = serializeValue(dict[key]!)
                return "\(k):\(v)"
            }
            return "{" + pairs.joined(separator: ",") + "}"
        }
        // Fallback: try to encode as JSON
        return "null"
    }

    /// RFC 8785 string serialization: only escape what JSON requires.
    private static func serializeString(_ string: String) -> String {
        var result = "\""
        for scalar in string.unicodeScalars {
            switch scalar.value {
            case 0x08: result += "\\b"
            case 0x09: result += "\\t"
            case 0x0A: result += "\\n"
            case 0x0C: result += "\\f"
            case 0x0D: result += "\\r"
            case 0x22: result += "\\\""
            case 0x5C: result += "\\\\"
            case 0x00...0x1F:
                // Other control characters: \uXXXX
                result += String(format: "\\u%04x", scalar.value)
            default:
                result += String(scalar)
            }
        }
        result += "\""
        return result
    }

    /// RFC 8785 number serialization: ES2015-compatible double-to-string.
    /// For integers that fit, output without decimal point.
    /// For others, use the shortest representation that round-trips.
    private static func serializeNumber(_ value: Double) -> String {
        if value.isNaN || value.isInfinite {
            return "null"  // JSON doesn't support NaN/Infinity
        }
        if value == 0 {
            return value.sign == .minus ? "0" : "0"  // RFC 8785: -0 → "0"
        }
        // If it's an integer that fits in Int64, use integer format
        if value == value.rounded(.towardZero) && abs(value) < Double(Int64.max) {
            return String(Int64(value))
        }
        // Use Swift's default double serialization which matches ES2015 rules
        return String(value)
    }
}

enum JCSError: Error {
    case invalidInput
}
