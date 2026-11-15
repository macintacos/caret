import Testing
@testable import CaretMenubarCore

@Test(
    "a plan arriving lights the carrot up",
    arguments: [IconState.idle, .unanswered])
func lightUp(from old: IconState) {
    #expect(IconTransition(from: old, to: .pending, reduceMotion: false) == .lightUp)
}

@Test(
    "the last plan leaving dims the carrot",
    arguments: [IconState.idle, .unanswered])
func dim(to new: IconState) {
    #expect(IconTransition(from: .pending, to: new, reduceMotion: false) == .dim)
}

@Test(
    "the first icon, and a change that keeps the carrot's colour, switch at once",
    arguments: [
        (nil, IconState.idle), (nil, .pending), (.idle, .unanswered), (.unanswered, .idle),
    ] as [(IconState?, IconState)])
func noColourChange(old: IconState?, new: IconState) {
    #expect(IconTransition(from: old, to: new, reduceMotion: false) == nil)
}

@Test(
    "under Reduce Motion the carrot switches at once",
    arguments: [(IconState.idle, IconState.pending), (.pending, .idle)])
func reduceMotion(old: IconState, new: IconState) {
    #expect(IconTransition(from: old, to: new, reduceMotion: true) == nil)
}
