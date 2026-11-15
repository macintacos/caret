import AppKit
import CaretMenubarCore

/// The menu's first item: a card of the running caret's version and review stats. It asks
/// the daemon as the menu opens, and at no other time.
final class StatsCard: NSObject, NSMenuDelegate {
    let item = NSMenuItem()
    private let view = StatsCardView()
    private let config: LaunchConfig
    private let session: URLSession
    private let bundleVersion =
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    private var fetch: Task<Void, Never>?
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
        let workspace = NSWorkspace.shared
        view.apply(
            CardStyle(
                reduceTransparency: workspace.accessibilityDisplayShouldReduceTransparency,
                increaseContrast: workspace.accessibilityDisplayShouldIncreaseContrast,
                glass: hasLiquidGlass))

        fetch?.cancel()
        fetch = Task { [weak self] in
            guard let self else { return }
            let outcome = await session.outcome(of: config.statsRequest())
            guard !Task.isCancelled else { return }
            show(CardState(outcome))
        }
    }

    private func show(_ state: CardState) {
        view.show(CardContent(state, bundleVersion: bundleVersion, locale: .current))
        accent = state.accent(keeping: accent)
        view.tint(accent)
    }
}

private var hasLiquidGlass: Bool {
    if #available(macOS 26, *) { true } else { false }
}
