import AppKit
import CaretMenubarCore

/// Polls the daemon and shows the answer as the menubar carrot.
@MainActor
final class StatusController: NSObject {
    private static let interval: TimeInterval = 3
    // Under the interval, so a hung request ends before the next tick is due.
    private static let timeout: TimeInterval = 2

    private let config: LaunchConfig
    private let session = URLSession(configuration: .ephemeral)
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let carrot = carrotImage(description: "caret: a plan is waiting for review")
    private let greyCarrot = carrotImage(description: "caret: nothing to review", template: true)
    private let unansweredItem = NSMenuItem(title: "caret didn't answer the app", action: nil, keyEquivalent: "")
    private var inFlight = false
    private var timer: Timer?

    init(config: LaunchConfig) {
        self.config = config
        super.init()
        statusItem.menu = makeMenu()
        show(.idle)
    }

    func start() {
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: Self.interval, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.poll() }
        }
    }

    private func makeMenu() -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        unansweredItem.isEnabled = false
        menu.addItem(unansweredItem)
        let open = NSMenuItem(title: "Open caret", action: #selector(openCaret), keyEquivalent: "")
        open.target = self
        open.isEnabled = isWebURL(config.reviewURL)
        menu.addItem(open)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        return menu
    }

    private func poll() {
        guard !inFlight else { return }
        inFlight = true
        var request = URLRequest(url: config.pendingURL, timeoutInterval: Self.timeout)
        if let token = bearerToken() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        session.dataTask(with: request) { [weak self] data, response, _ in
            let outcome: PollOutcome = (response as? HTTPURLResponse).map {
                .response(status: $0.statusCode, body: data ?? Data())
            } ?? .noResponse
            Task { @MainActor [weak self] in
                self?.inFlight = false
                self?.show(iconState(for: outcome))
            }
        }.resume()
    }

    /// Re-read on every poll, so a token the daemon rotates is picked up; trimmed like
    /// `readToken` in src/daemon/token.ts.
    private func bearerToken() -> String? {
        guard let path = config.tokenFile,
              let contents = try? String(contentsOfFile: path, encoding: .utf8)
        else { return nil }
        let token = contents.trimmingCharacters(in: .whitespacesAndNewlines)
        return token.isEmpty ? nil : token
    }

    private func show(_ state: IconState) {
        statusItem.button?.image = state == .pending ? carrot : greyCarrot
        unansweredItem.isHidden = state != .unanswered
    }

    @objc private func openCaret() {
        guard isWebURL(config.reviewURL) else { return }
        NSWorkspace.shared.open(config.reviewURL)
    }
}

/// 🥕 drawn from the system emoji font at runtime: Apple's artwork is never shipped. As a
/// template image only its alpha is used, so the grey icon is the same silhouette.
private func carrotImage(description: String, template: Bool = false) -> NSImage {
    let glyph = NSAttributedString(string: "🥕", attributes: [.font: NSFont.systemFont(ofSize: 15)])
    let image = NSImage(size: NSSize(width: 18, height: 18), flipped: false) { rect in
        let size = glyph.size()
        glyph.draw(at: NSPoint(x: (rect.width - size.width) / 2, y: (rect.height - size.height) / 2))
        return true
    }
    image.isTemplate = template
    image.accessibilityDescription = description
    return image
}
