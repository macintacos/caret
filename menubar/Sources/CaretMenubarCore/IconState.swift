import Foundation

/// What one request to the daemon came back with.
package enum PollOutcome: Equatable, Sendable {
    /// The daemon answered over HTTP.
    case response(status: Int, body: Data)
    /// No HTTP answer: the connection was refused, timed out, or failed some other way.
    case noResponse
}

/// What the menubar shows.
package enum IconState: Equatable, Sendable {
    /// A plan waits for review: the coloured carrot.
    case pending
    /// Nothing to review, or no daemon to ask: the grey carrot.
    case idle
    /// The daemon answered, but not with a count: the grey carrot, plus a menu line saying so.
    case unanswered
}

extension IconState {
    /// Whether the menubar shows the coloured carrot.
    package var isColoured: Bool {
        switch self {
        case .pending: true
        case .idle, .unanswered: false
        }
    }
}

private struct PendingBody: Decodable {
    let pending: Int
}

extension IconState {
    /// Maps one poll to the icon: no answer, or a 404 from a daemon older than the route, is
    /// idle; a 200 `{"pending": n}` is pending when n > 0, idle otherwise; anything else is
    /// unanswered.
    package init(_ outcome: PollOutcome) {
        switch outcome {
        case .noResponse, .response(status: 404, body: _):
            self = .idle
        case let .response(status: 200, body: body):
            guard let count = try? JSONDecoder().decode(PendingBody.self, from: body).pending
            else {
                self = .unanswered
                return
            }
            self = count > 0 ? .pending : .idle
        case .response:
            self = .unanswered
        }
    }
}
