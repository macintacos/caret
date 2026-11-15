import Foundation

/// What one poll of `GET /api/pending` came back with.
public enum PollOutcome: Equatable, Sendable {
    /// The daemon answered over HTTP.
    case response(status: Int, body: Data)
    /// No HTTP answer: the connection was refused, timed out, or failed some other way.
    case noResponse
}

/// What the menubar shows.
public enum IconState: Equatable, Sendable {
    /// A plan waits for review: the coloured carrot.
    case pending
    /// Nothing to review, or no daemon to ask: the grey carrot.
    case idle
    /// The daemon answered, but not with a count: the grey carrot, plus a menu line saying so.
    case unanswered
}

private struct PendingBody: Decodable {
    let pending: Int
}

/// Maps one poll to the icon: no answer, or a 404 from a daemon older than the route, is idle; a
/// 200 `{"pending": n}` is pending when n > 0, idle otherwise; anything else is unanswered.
public func iconState(for outcome: PollOutcome) -> IconState {
    switch outcome {
    case .noResponse, .response(status: 404, body: _):
        return .idle
    case let .response(status: 200, body: body):
        guard let count = try? JSONDecoder().decode(PendingBody.self, from: body).pending else {
            return .unanswered
        }
        return count > 0 ? .pending : .idle
    case .response:
        return .unanswered
    }
}
