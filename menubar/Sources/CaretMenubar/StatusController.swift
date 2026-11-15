import AppKit
import CaretMenubarCore
import os

/// Polls the daemon and shows the answer as the menubar carrot.
final class StatusController: NSObject {
    private static let log = Logger(subsystem: "dev.excessive.caret.menubar", category: "poll")

    private let config: LaunchConfig
    private let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        // A whole-request deadline, under the poll interval; the request's own timeout is idle-only.
        configuration.timeoutIntervalForResource = 2
        return URLSession(configuration: configuration)
    }()
    private let statusItem = NSStatusBar.system.statusItem(
        withLength: NSStatusItem.variableLength)
    private let colouredCarrot = carrotImage(description: "caret: a plan is waiting for review")
    private let greyCarrot = carrotImage(description: "caret: nothing to review", template: true)
    private let unansweredItem = NSMenuItem(
        title: "caret didn't answer the app", action: nil, keyEquivalent: "")
    /// What the last poll showed; nil until the first poll answers, while the grey placeholder
    /// stands in.
    private var state: IconState?
    private var pollTask: Task<Void, Never>?

    init(config: LaunchConfig) {
        self.config = config
        super.init()
        statusItem.menu = makeMenu()
        show(.idle)
        // The grey carrot stands in until the first poll answers, so that answer lands at once.
        state = nil
    }

    func start() {
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.poll()
                try? await Task.sleep(for: .seconds(3), tolerance: .seconds(1))
            }
        }
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        unansweredItem.isEnabled = false
        menu.addItem(unansweredItem)
        let openItem = NSMenuItem(
            title: "Open caret", action: #selector(openCaret), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)
        menu.addItem(.separator())
        menu.addItem(
            NSMenuItem(
                title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        return menu
    }

    private func poll() async {
        let outcome: PollOutcome
        do {
            let (data, response) = try await session.data(for: config.pendingRequest())
            outcome =
                (response as? HTTPURLResponse).map { .response(status: $0.statusCode, body: data) }
                ?? .noResponse
        } catch {
            outcome = .noResponse
        }
        show(IconState(outcome))
    }

    private func show(_ newState: IconState) {
        guard newState != state else { return }
        statusItem.button?.animateImageChange(
            IconTransition(
                from: state, to: newState,
                reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion))
        state = newState
        Self.log.notice("icon \(String(describing: newState), privacy: .public)")
        switch newState {
        case .pending:
            statusItem.button?.image = colouredCarrot
            unansweredItem.isHidden = true
        case .idle:
            statusItem.button?.image = greyCarrot
            unansweredItem.isHidden = true
        case .unanswered:
            statusItem.button?.image = greyCarrot
            unansweredItem.isHidden = false
        }
    }

    @objc private func openCaret() {
        NSWorkspace.shared.open(config.reviewURL)
    }
}

/// 🥕 drawn from the system emoji font at runtime: Apple's artwork is never shipped. As a
/// template image only its alpha is used, so the grey icon is the same silhouette.
private func carrotImage(description: String, template: Bool = false) -> NSImage {
    let glyph = NSAttributedString(string: "🥕", attributes: [.font: NSFont.systemFont(ofSize: 15)])
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
        let size = glyph.size()
        glyph.draw(
            at: NSPoint(x: (rect.width - size.width) / 2, y: (rect.height - size.height) / 2))
        return true
    }
    image.isTemplate = template
    image.accessibilityDescription = description
    return image
}
