import AppKit
import CaretMenubarCore

/// The menu's first item: a card of the running caret's version and review stats. It asks
/// the daemon as the menu opens, and at no other time.
final class StatsCard: NSObject, NSMenuDelegate {
    let item = NSMenuItem()
    private let view = StatsCardView(style: currentStyle())
    private let config: LaunchConfig
    private let session: URLSession
    private let bundleVersion =
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    private var inFlightFetch: Task<Void, Never>?
    private var accent = Accent.caret

    init(config: LaunchConfig, session: URLSession) {
        self.config = config
        self.session = session
        super.init()
        item.view = view
        item.isEnabled = false
        show(.quiet)
    }

    func menuWillOpen(_ menu: NSMenu) {
        view.apply(currentStyle())

        inFlightFetch?.cancel()
        inFlightFetch = Task { [weak self] in
            guard let self,
                let outcome = try? await session.outcome(of: config.statsRequest())
            else { return }
            show(CardState(outcome))
        }
    }

    private func show(_ state: CardState) {
        view.show(CardContent(state, bundleVersion: bundleVersion, locale: .current))
        accent = state.accent(keeping: accent)
        view.tint(accent)
    }
}

/// The card's style under the system's display settings as they stand now.
private func currentStyle() -> CardStyle {
    let workspace = NSWorkspace.shared
    return CardStyle(
        reduceTransparency: workspace.accessibilityDisplayShouldReduceTransparency,
        increaseContrast: workspace.accessibilityDisplayShouldIncreaseContrast,
        hasLiquidGlass: hasLiquidGlass)
}

private var hasLiquidGlass: Bool {
    if #available(macOS 26, *) { true } else { false }
}
