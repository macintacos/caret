import Foundation

/// The body of `GET /api/stats`: the running caret's version, its review tally, and the
/// accents the review page last reported.
package struct ReviewStats: Equatable, Sendable {
    /// Nil when the daemon sends none; the app's own version stands in.
    package let version: String?
    package let approved: Int
    package let rejected: Int
    package let revisions: Int
    package let comments: Int
    /// Nil when the review page has reported none, or sent one that isn't two hex colours.
    package let accent: Accent?
}

extension ReviewStats: Decodable {
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
        light = try Self.rgb(fields.decode(String.self, forKey: .light), at: [CodingKeys.light])
        dark = try Self.rgb(fields.decode(String.self, forKey: .dark), at: [CodingKeys.dark])
    }

    private static func rgb(_ hex: String, at path: [any CodingKey]) throws -> Int {
        guard hex.wholeMatch(of: /#[0-9a-fA-F]{6}/) != nil,
            let rgb = Int(hex.dropFirst(), radix: 16)
        else {
            throw DecodingError.dataCorrupted(
                .init(codingPath: path, debugDescription: "not a #rrggbb colour: \(hex)"))
        }
        return rgb
    }
}

/// What the stats card shows, decided by the request the menu sends as it opens.
package enum CardState: Equatable, Sendable {
    /// The daemon answered with its stats.
    case stats(ReviewStats)
    /// No daemon answered, or one older than the route: a dash for each count.
    case quiet
    /// The daemon answered, but not with stats: the card says so.
    case unanswered
}

extension CardState {
    /// Maps the menu's request by the icon's rule: no answer or a 404 is quiet, a 200 with
    /// stats shows them, and anything else is unanswered.
    package init(_ outcome: PollOutcome) {
        switch outcome {
        case .noResponse, .response(status: 404, body: _):
            self = .quiet
        case let .response(status: 200, body: body):
            guard let stats = try? JSONDecoder().decode(ReviewStats.self, from: body) else {
                self = .unanswered
                return
            }
            self = .stats(stats)
        case .response:
            self = .unanswered
        }
    }

    /// The accent to tint with after this answer: the one the daemon reports, caret's own
    /// when it has none, and `current` when no stats came back at all.
    package func accent(keeping current: Accent) -> Accent {
        if case let .stats(stats) = self { stats.accent ?? .caret } else { current }
    }

    fileprivate var daemonVersion: String? {
        if case let .stats(stats) = self { stats.version } else { nil }
    }
}

/// One count on the card: the figure, and what it counts.
package struct Figure: Equatable, Sendable {
    package let value: String
    package let label: String
}

extension Figure {
    fileprivate init(count: Int, one: String, other: String, locale: Locale) {
        value = count.formatted(.number.locale(locale))
        label = count == 1 ? one : other
    }
}

/// The card's text for one state, for the eye and for VoiceOver.
package struct CardContent: Equatable, Sendable {
    package enum Body: Equatable, Sendable {
        case figures([Figure])
        case note(String)
    }

    /// The daemon's version, else the app's; nil when neither has one.
    package let version: String?
    package let body: Body
    /// The whole card as one sentence.
    package let accessibilityLabel: String

    package init(_ state: CardState, bundleVersion: String?, locale: Locale) {
        let summary: String
        switch state {
        case let .stats(stats):
            let figures = [
                Figure(
                    count: stats.approved, one: "plan approved", other: "plans approved",
                    locale: locale),
                Figure(
                    count: stats.rejected, one: "plan rejected", other: "plans rejected",
                    locale: locale),
                Figure(count: stats.revisions, one: "revision", other: "revisions", locale: locale),
                Figure(count: stats.comments, one: "comment", other: "comments", locale: locale),
            ]
            body = .figures(figures)
            summary = figures.map { "\($0.value) \($0.label)" }.joined(separator: ", ")
        case .quiet:
            body = .figures(
                ["plans approved", "plans rejected", "revisions", "comments"].map {
                    Figure(value: "—", label: $0)
                })
            summary = "Review stats unavailable"
        case .unanswered:
            body = .note("caret didn't answer the app")
            summary = "caret didn't answer the app"
        }

        let version = state.daemonVersion ?? bundleVersion
        self.version = version
        let name = ["caret", version].compactMap { $0 }.joined(separator: " ")
        accessibilityLabel = "\(name). \(summary)."
    }
}

/// How the card's background meets the system's display settings.
package struct CardStyle: Equatable, Sendable {
    package enum Material: Equatable, Sendable {
        /// Liquid Glass, on macOS 26 and later.
        case glass
        /// The vibrant material menus wore before Liquid Glass.
        case vibrant
        /// An opaque fill, for Reduce Transparency.
        case solid
    }

    package let material: Material
    /// In points: none where glass draws its own edge, a hairline elsewhere, and a full
    /// point under Increase Contrast.
    package let borderWidth: Double

    /// - Parameter glass: Whether this macOS has Liquid Glass.
    package init(reduceTransparency: Bool, increaseContrast: Bool, glass: Bool) {
        material =
            if reduceTransparency { .solid } else if glass { .glass } else { .vibrant }
        borderWidth = if increaseContrast { 1 } else if material == .glass { 0 } else { 0.5 }
    }
}
