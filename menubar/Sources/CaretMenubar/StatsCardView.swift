import AppKit
import CaretMenubarCore

/// The stats card's view: the wordmark and version over four counts in two pairs, on a
/// background that follows the system's display settings and carries a wash of the review
/// page's accent. VoiceOver reads it as one sentence.
final class StatsCardView: NSView {
    private static let size = NSSize(width: 252, height: 122)
    /// Lines the card up with the menu's own row highlight.
    private static let inset = NSSize(width: 5, height: 3)
    private static let padding = NSSize(width: 12, height: 10)
    private static let columnWidth: CGFloat = 103

    private let content = NSView()
    private let wordmark = NSTextField(labelWithString: "")
    private let versionLabel = label(font: .monospacedSystemFont(ofSize: 11, weight: .regular))
    private let tiles = (0..<4).map { _ in
        (
            value: label(font: .monospacedDigitSystemFont(ofSize: textSize + 2, weight: .semibold)),
            label: label(font: .systemFont(ofSize: 11))
        )
    }
    private lazy var figures = NSGridView(views: [
        [stack(tiles[0]), stack(tiles[1])], [stack(tiles[2]), stack(tiles[3])],
    ])
    private let note = label(font: .systemFont(ofSize: textSize))
    private let wash = box(fill: .clear)
    private let edge = box(fill: .clear)
    private var card: NSView?
    private var material: CardStyle.Material?

    init() {
        super.init(frame: NSRect(origin: .zero, size: Self.size))
        autoresizingMask = [.width]
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        layOutContent()
        edge.borderColor = .separatorColor
        place(edge, in: self)
        tint(.caret)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show(_ content: CardContent) {
        versionLabel.stringValue = content.version ?? ""
        switch content.body {
        case let .figures(values):
            for (tile, figure) in zip(tiles, values) {
                tile.value.stringValue = figure.value
                tile.label.stringValue = figure.label
            }
            figures.isHidden = false
            note.isHidden = true
        case let .note(text):
            note.stringValue = text
            figures.isHidden = true
            note.isHidden = false
        }
        setAccessibilityLabel(content.accessibilityLabel)
    }

    /// Takes `accent` for the wordmark's `^` and for the wash in the card's background.
    func tint(_ accent: Accent) {
        wordmark.attributedStringValue = wordmarkText(caret: color(accent))
        let washColor = color(accent, alpha: washStrength)
        wash.fillColor = washColor
        if #available(macOS 26, *), let glass = card as? NSGlassEffectView {
            glass.tintColor = washColor
        }
    }

    func apply(_ style: CardStyle) {
        edge.borderWidth = style.borderWidth
        guard style.material != material else { return }

        material = style.material
        card?.removeFromSuperview()
        let card = makeCard(style.material)
        place(card, in: self)
        pin(content, to: card)
        addSubview(edge)
        self.card = card
    }

    private func place(_ view: NSView, in parent: NSView) {
        view.frame =
            parent === self
            ? bounds.insetBy(dx: Self.inset.width, dy: Self.inset.height) : parent.bounds
        view.autoresizingMask = [.width, .height]
        parent.addSubview(view)
    }

    private func layOutContent() {
        let body = NSView()
        for column in 0..<2 { figures.column(at: column).width = Self.columnWidth }
        figures.rowSpacing = 8
        figures.columnSpacing = 12
        for view in [wordmark, versionLabel, body] { content.addSubview(view) }
        for view in [figures, note] { body.addSubview(view) }
        for view in [content, wordmark, versionLabel, body, figures, note] {
            view.translatesAutoresizingMaskIntoConstraints = false
        }
        for view in [wordmark, versionLabel, note] + tiles.flatMap({ [$0.value, $0.label] }) {
            view.setAccessibilityElement(false)
        }

        let pad = Self.padding
        NSLayoutConstraint.activate([
            wordmark.leadingAnchor.constraint(equalTo: content.leadingAnchor, constant: pad.width),
            wordmark.topAnchor.constraint(equalTo: content.topAnchor, constant: pad.height),
            versionLabel.trailingAnchor.constraint(
                equalTo: content.trailingAnchor, constant: -pad.width),
            versionLabel.firstBaselineAnchor.constraint(equalTo: wordmark.firstBaselineAnchor),
            body.leadingAnchor.constraint(equalTo: wordmark.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: versionLabel.trailingAnchor),
            body.bottomAnchor.constraint(equalTo: content.bottomAnchor, constant: -pad.height),
            body.heightAnchor.constraint(equalTo: figures.heightAnchor),
            figures.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            figures.topAnchor.constraint(equalTo: body.topAnchor),
            note.leadingAnchor.constraint(equalTo: body.leadingAnchor),
            note.trailingAnchor.constraint(lessThanOrEqualTo: body.trailingAnchor),
            note.centerYAnchor.constraint(equalTo: body.centerYAnchor),
        ])
    }

    /// The background for `material`, washed with the accent and holding the content.
    private func makeCard(_ material: CardStyle.Material) -> NSView {
        content.removeFromSuperview()
        wash.removeFromSuperview()
        switch material {
        case .glass:
            if #available(macOS 26, *) {
                let glass = NSGlassEffectView()
                glass.cornerRadius = cornerRadius
                glass.tintColor = wash.fillColor
                glass.contentView = content
                return glass
            }
            return washed(vibrantBackground())
        case .vibrant:
            return washed(vibrantBackground())
        case .solid:
            return washed(box(fill: .quaternaryLabelColor))
        }
    }

    private func vibrantBackground() -> NSView {
        let vibrant = NSVisualEffectView()
        vibrant.material = .menu
        vibrant.blendingMode = .withinWindow
        vibrant.state = .active
        vibrant.wantsLayer = true
        vibrant.layer?.cornerRadius = cornerRadius
        vibrant.layer?.masksToBounds = true
        return vibrant
    }

    private func washed(_ background: NSView) -> NSView {
        background.frame.size = bounds.insetBy(dx: Self.inset.width, dy: Self.inset.height).size
        place(wash, in: background)
        background.addSubview(content)
        return background
    }

    private func pin(_ content: NSView, to card: NSView) {
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            content.topAnchor.constraint(equalTo: card.topAnchor),
            content.bottomAnchor.constraint(equalTo: card.bottomAnchor),
        ])
    }
}

private let cornerRadius: CGFloat = 10

/// The menu's own text size, so the card reads at the size of the rows beneath it.
private let textSize = NSFont.menuFont(ofSize: 0).pointSize

/// How much of the accent washes the card, per appearance: enough to read as the theme,
/// too little to move its text's contrast.
private let washStrength = (light: 0.07, dark: 0.06)

private func label(font: NSFont) -> NSTextField {
    let field = NSTextField(labelWithString: "")
    field.font = font
    return field
}

private func stack(_ tile: (value: NSTextField, label: NSTextField)) -> NSStackView {
    let stack = NSStackView(views: [tile.value, tile.label])
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 0
    return stack
}

/// A rounded box that re-resolves its colours when the appearance changes.
private func box(fill: NSColor) -> NSBox {
    let box = NSBox()
    box.boxType = .custom
    box.titlePosition = .noTitle
    box.cornerRadius = cornerRadius
    box.borderWidth = 0
    box.fillColor = fill
    box.contentViewMargins = .zero
    return box
}

/// `^caret`, with the `^` bold in the accent, as the review page sets it.
private func wordmarkText(caret: NSColor) -> NSAttributedString {
    let text = NSMutableAttributedString(
        string: "^",
        attributes: [
            .font: NSFont.systemFont(ofSize: textSize, weight: .bold), .foregroundColor: caret,
        ])
    text.append(
        NSAttributedString(
            string: "caret",
            attributes: [
                .font: NSFont.systemFont(ofSize: textSize, weight: .semibold),
                .foregroundColor: NSColor.labelColor,
            ]))
    return text
}

/// `accent` as a colour that follows the appearance it is drawn in.
private func color(
    _ accent: Accent, alpha: (light: Double, dark: Double) = (1, 1)
) -> NSColor {
    NSColor(name: nil) { appearance in
        let dark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
        let rgb = dark ? accent.dark : accent.light
        return NSColor(
            srgbRed: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255, alpha: dark ? alpha.dark : alpha.light)
    }
}
