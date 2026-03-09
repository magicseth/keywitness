import ActivityKit
import Foundation

struct KeyWitnessVerificationAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var status: String // "waiting", "verified", "expired"
    }

    var shortId: String
    var messagePreview: String
    var expiresAt: Date
}
