import Foundation
import Testing

@testable import CaretMenubarCore

private let enUS = Locale(identifier: "en_US")

private func stats(_ json: String) -> PollOutcome {
    .response(status: 200, body: Data(json.utf8))
}

private func tally(
    version: String? = nil, approved: Int = 0, rejected: Int = 0, revisions: Int = 0,
    comments: Int = 0, accent: Accent? = nil
) -> StatsBody {
    StatsBody(
        version: version, approved: approved, rejected: rejected, revisions: revisions,
        comments: comments, accent: accent)
}

private let dracula = Accent(light: 0x8839EF, dark: 0xBD93F9)

@Test("a stats body decodes to the running version, the tally and the accent")
func statsBody() {
    let body = #"""
        {"version":"1.10.1","approved":12,"rejected":2,"revisions":9,"comments":30,
         "accent":{"light":"#8839ef","dark":"#BD93F9"}}
        """#
    #expect(
        CardState(stats(body))
            == .stats(
                tally(
                    version: "1.10.1", approved: 12, rejected: 2, revisions: 9, comments: 30,
                    accent: dracula)))
}

@Test("a stats body with no version or accent still shows the tally")
func statsWithoutVersionOrAccent() {
    #expect(
        CardState(stats(#"{"approved":1,"rejected":0,"revisions":0,"comments":0}"#))
            == .stats(tally(approved: 1)))
}

@Test("an accent that isn't two hex colours is dropped, and the tally still shows")
func malformedAccent() {
    let body = #"""
        {"approved":1,"rejected":0,"revisions":0,"comments":0,
         "accent":{"light":"rebeccapurple","dark":"#bd93f9"}}
        """#
    #expect(CardState(stats(body)) == .stats(tally(approved: 1)))
}

@Test(
    "no daemon, or one older than the route, leaves the card quiet",
    arguments: [PollOutcome.noResponse, .response(status: 404, body: Data("not found".utf8))])
func quiet(outcome: PollOutcome) {
    #expect(CardState(outcome) == .quiet)
}

@Test(
    "the card says caret didn't answer exactly when the icon does",
    arguments: [
        PollOutcome.noResponse,
        .response(status: 404, body: Data()),
        .response(status: 401, body: Data(#"{"error":"caret daemon token required"}"#.utf8)),
        .response(status: 403, body: Data("host not recognized".utf8)),
        .response(status: 500, body: Data()),
        .response(status: 200, body: Data("not json".utf8)),
    ])
func agreesWithIcon(outcome: PollOutcome) {
    #expect((CardState(outcome) == .unanswered) == (IconState(outcome) == .unanswered))
}

@Test("the card tints with the accent the daemon reports")
func reportedAccent() {
    #expect(CardState.stats(tally(accent: dracula)).accent(keeping: .caret) == dracula)
}

@Test("a daemon with no accent reported tints with caret's own")
func defaultAccent() {
    #expect(CardState.stats(tally()).accent(keeping: dracula) == .caret)
}

@Test(
    "with no stats to read, the card keeps the last accent it had",
    arguments: [CardState.quiet, .unanswered])
func keptAccent(state: CardState) {
    #expect(state.accent(keeping: dracula) == dracula)
}

@Test("the version shown is the daemon's, not the app's")
func daemonVersionWins() {
    let state = CardState.stats(tally(version: "1.10.1"))
    #expect(CardContent(state, bundleVersion: "1.9.0", locale: enUS).version == "1.10.1")
}

@Test(
    "the app's own version stands in when the daemon gives none",
    arguments: [CardState.stats(tally()), .quiet, .unanswered])
func bundleVersionFallback(state: CardState) {
    #expect(CardContent(state, bundleVersion: "1.9.0", locale: enUS).version == "1.9.0")
}

@Test("decisions come first, then feedback; counts read in the reader's locale, one singular")
func figures() {
    let state = CardState.stats(tally(approved: 1, rejected: 2, revisions: 1, comments: 1208))
    #expect(
        CardContent(state, bundleVersion: nil, locale: enUS).body
            == .figures([
                Figure(value: "1", label: "plan approved"),
                Figure(value: "2", label: "plans rejected"),
                Figure(value: "1", label: "revision"),
                Figure(value: "1,208", label: "comments"),
            ]))
}

@Test("a quiet card keeps every slot, with a dash for each count")
func quietFigures() {
    #expect(
        CardContent(.quiet, bundleVersion: nil, locale: enUS).body
            == .figures([
                Figure(value: "—", label: "plans approved"),
                Figure(value: "—", label: "plans rejected"),
                Figure(value: "—", label: "revisions"),
                Figure(value: "—", label: "comments"),
            ]))
}

@Test(
    "VoiceOver reads the card as one sentence in every state",
    arguments: [
        (
            CardState.stats(tally(approved: 12, rejected: 1, revisions: 4, comments: 30)),
            "caret 1.10.1. 12 plans approved, 1 plan rejected, 4 revisions, 30 comments."
        ),
        (.quiet, "caret 1.10.1. Review stats unavailable."),
        (.unanswered, "caret 1.10.1. caret didn't answer the app."),
    ])
func accessibilityLabel(state: CardState, label: String) {
    #expect(CardContent(state, bundleVersion: "1.10.1", locale: enUS).accessibilityLabel == label)
}

@Test("with no version anywhere, VoiceOver reads the name alone")
func accessibilityLabelWithoutVersion() {
    #expect(
        CardContent(.quiet, bundleVersion: nil, locale: enUS).accessibilityLabel
            == "caret. Review stats unavailable.")
}

@Test("Reduce Transparency turns every material solid", arguments: [true, false])
func reduceTransparency(hasLiquidGlass: Bool) {
    let style = CardStyle(
        reduceTransparency: true, increaseContrast: false, hasLiquidGlass: hasLiquidGlass)
    #expect(style.material == .solid)
}

@Test("the card is Liquid Glass where the system has it, and vibrant below")
func materials() {
    #expect(
        CardStyle(reduceTransparency: false, increaseContrast: false, hasLiquidGlass: true).material
            == .glass)
    #expect(
        CardStyle(reduceTransparency: false, increaseContrast: false, hasLiquidGlass: false)
            .material
            == .vibrant)
}

@Test(
    "Increase Contrast draws every card's edge a full point wide",
    arguments: [(false, true), (false, false), (true, false)])
func increaseContrast(reduceTransparency: Bool, hasLiquidGlass: Bool) {
    let style = CardStyle(
        reduceTransparency: reduceTransparency, increaseContrast: true,
        hasLiquidGlass: hasLiquidGlass)
    #expect(style.borderWidth == 1)
}

@Test("glass draws its own edge, and the other materials take a hairline")
func defaultBorders() {
    #expect(
        CardStyle(reduceTransparency: false, increaseContrast: false, hasLiquidGlass: true)
            .borderWidth
            == 0)
    #expect(
        CardStyle(reduceTransparency: false, increaseContrast: false, hasLiquidGlass: false)
            .borderWidth
            == 0.5)
    #expect(
        CardStyle(reduceTransparency: true, increaseContrast: false, hasLiquidGlass: true)
            .borderWidth
            == 0.5)
}
