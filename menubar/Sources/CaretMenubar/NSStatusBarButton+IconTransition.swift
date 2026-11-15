import AppKit
import CaretMenubarCore

private let fadeKey = "caret.icon.fade"
private let growKey = "caret.icon.grow"

extension NSStatusBarButton {
    /// Animates the image change made next in this run-loop pass, or lets it land at once when
    /// `transition` is nil. Stops whatever an earlier change left running, so changes never
    /// stack.
    func animateImageChange(_ transition: IconTransition?) {
        layer?.removeAnimation(forKey: fadeKey)
        superview?.layer?.removeAnimation(forKey: growKey)
        guard let transition else { return }

        // --dur-state and --ease-out in ui/src/styles/tokens.css.
        let duration = 0.16
        let curve = CAMediaTimingFunction(controlPoints: 0.22, 1, 0.36, 1)

        // The system tints the template image itself; a fade between the two renders keeps
        // that tint on both sides.
        let fade = CATransition()
        fade.type = .fade
        fade.duration = duration
        fade.timingFunction = curve
        layer?.add(fade, forKey: fadeKey)

        // The fade drops any transform on the button's own layer, so the grow rides its
        // superview's.
        guard transition == .lightUp, let host = superview?.layer else { return }
        let grow = CABasicAnimation(keyPath: "transform")
        grow.fromValue = scale(0.85, aboutCentreOf: host)
        grow.toValue = CATransform3DIdentity
        grow.duration = duration
        grow.timingFunction = curve
        host.add(grow, forKey: growKey)
    }
}

/// A scale about the layer's centre, wherever AppKit put its anchor point.
private func scale(_ factor: CGFloat, aboutCentreOf layer: CALayer) -> CATransform3D {
    let dx = layer.bounds.width * (0.5 - layer.anchorPoint.x)
    let dy = layer.bounds.height * (0.5 - layer.anchorPoint.y)
    let scaled = CATransform3DScale(CATransform3DMakeTranslation(dx, dy, 0), factor, factor, 1)
    return CATransform3DTranslate(scaled, -dx, -dy, 0)
}
