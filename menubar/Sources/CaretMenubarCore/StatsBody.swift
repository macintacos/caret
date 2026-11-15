import Foundation

/// The body of `GET /api/stats`: the running caret's version, its review tally, and the
/// accents the review page last reported.
package struct StatsBody: Equatable, Sendable {
    /// Nil when the daemon sends none; the app's own version stands in.
    package let version: String?
    package let approved: Int
    package let rejected: Int
    package let revisions: Int
    package let comments: Int
    /// Nil when the review page has reported none, or sent one that isn't two hex colours.
    package let accent: Accent?

    package subscript(_ tally: Tally) -> Int {
        switch tally {
        case .approved: approved
        case .rejected: rejected
        case .revisions: revisions
        case .comments: comments
        }
    }
}

extension StatsBody: Decodable {
    private enum CodingKeys: String, CodingKey {
        case version, approved, rejected, revisions, comments, accent
    }

    package init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        version = try fields.decodeIfPresent(String.self, forKey: .version)
        approved = try fields.decode(Int.self, forKey: .approved)
        rejected = try fields.decode(Int.self, forKey: .rejected)
        revisions = try fields.decode(Int.self, forKey: .revisions)
        comments = try fields.decode(Int.self, forKey: .comments)
        // A bad tint must not cost the counts.
        accent = try? fields.decodeIfPresent(Accent.self, forKey: .accent)
    }
}

/// The accent of the theme in each of the review page's scheme slots, as sRGB.
package struct Accent: Equatable, Sendable {
    package let light: Int
    package let dark: Int

    /// caret's own accent, from its default light and dark themes; contract.json pins it.
    package static let caret = Accent(light: 0xC2490D, dark: 0xFF8F3D)
}

extension Accent: Decodable {
    private enum CodingKeys: String, CodingKey { case light, dark }

    package init(from decoder: any Decoder) throws {
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        light = try Self.rgb(in: fields, forKey: .light)
        dark = try Self.rgb(in: fields, forKey: .dark)
    }

    private static func rgb(
        in fields: KeyedDecodingContainer<CodingKeys>, forKey key: CodingKeys
    ) throws -> Int {
        let hex = try fields.decode(String.self, forKey: key)
        guard hex.wholeMatch(of: /#[0-9a-fA-F]{6}/) != nil,
            let rgb = Int(hex.dropFirst(), radix: 16)
        else {
            throw DecodingError.dataCorruptedError(
                forKey: key, in: fields, debugDescription: "not a #rrggbb colour: \(hex)")
        }
        return rgb
    }
}
