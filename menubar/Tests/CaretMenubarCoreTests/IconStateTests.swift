import Foundation
import Testing
@testable import CaretMenubarCore

@Test("a count above zero shows the coloured carrot")
func pendingCount() {
    #expect(IconState(.response(status: 200, body: Data(#"{"pending":2}"#.utf8))) == .pending)
}

@Test(
    "zero, no daemon, and an older daemon all show grey",
    arguments: [
        PollOutcome.response(status: 200, body: Data(#"{"pending":0}"#.utf8)),
        .noResponse,
        .response(status: 404, body: Data()),
    ])
func idle(outcome: PollOutcome) {
    #expect(IconState(outcome) == .idle)
}

@Test(
    "a 401, any other status, or a body without a count is an unanswered poll",
    arguments: [
        PollOutcome.response(
            status: 401, body: Data(#"{"error":"caret daemon token required"}"#.utf8)),
        .response(status: 403, body: Data("host not recognized".utf8)),
        .response(status: 500, body: Data()),
        .response(status: 200, body: Data("not json".utf8)),
    ])
func unanswered(outcome: PollOutcome) {
    #expect(IconState(outcome) == .unanswered)
}
