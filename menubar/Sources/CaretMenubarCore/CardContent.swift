import Foundation

/// What the stats card shows, decided by the request the menu sends as it opens.
package enum CardState: Equatable, Sendable {
    /// The daemon answered with its stats.
    case stats(StatsBody)
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
            guard let stats = try? JSONDecoder().decode(StatsBody.self, from: body) else {
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

/// The four counts the card shows, in its order.
package enum Tally: CaseIterable, Sendable {
    case approved, rejected, revisions, comments

    var labels: (one: String, other: String) {
        switch self {
        case .approved: ("plan approved", "plans approved")
        case .rejected: ("plan rejected", "plans rejected")
        case .revisions: ("revision", "revisions")
        case .comments: ("comment", "comments")
        }
    }
}

/// One count on the card: the figure, and what it counts.
package struct Figure: Equatable, Sendable {
    package let value: String
    package let label: String
}

extension Figure {
    fileprivate init(count: Int, labels: (one: String, other: String), locale: Locale) {
        value = count.formatted(.number.locale(locale))
        label = count == 1 ? labels.one : labels.other
    }
}

/// The card's text for one state, for the eye and for VoiceOver.
package struct CardContent: Equatable, Sendable {
    package enum Body: Equatable, Sendable {
        /// One per `Tally`, in its order.
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
            let figures = Tally.allCases.map {
                Figure(count: stats[$0], labels: $0.labels, locale: locale)
            }
            body = .figures(figures)
            summary = figures.map { "\($0.value) \($0.label)" }.joined(separator: ", ")
        case .quiet:
            body = .figures(Tally.allCases.map { Figure(value: "—", label: $0.labels.other) })
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
