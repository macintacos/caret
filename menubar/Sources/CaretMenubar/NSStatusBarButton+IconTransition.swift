import AppKit
import CaretMenubarCore

private let growKey = "caret.icon.grow"

extension NSStatusBarButton {
    /// Animates the image change made next in this run-loop pass, or lets it land at once when
    /// `transition` is nil. A light-up also scales the button's superview. Any fade or grow an
    /// earlier change left running stops first, so changes never stack.
    func animateImageChange(_ transition: IconTransition?) {
        layer?.removeAnimation(forKey: kCATransition)
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
        layer?.add(fade, forKey: kCATransition)

        switch transition {
        case .lightUp:
            // The fade drops any transform on the button's own layer, so the grow rides the
            // button-sized wrapper AppKit puts it in. The wrapper is private: grow only while
            // it still matches the button.
            guard let wrapper = superview?.layer, wrapper.bounds.size == bounds.size else { return }
            let grow = CABasicAnimation(keyPath: #keyPath(CALayer.transform))
            grow.fromValue = wrapper.centredScale(0.85)
            grow.toValue = CATransform3DIdentity
            grow.duration = duration
            grow.timingFunction = curve
            wrapper.add(grow, forKey: growKey)
        case .dim:
            break
        }
    }
}

extension CALayer {
    /// A scale about the layer's centre, wherever AppKit put its anchor point.
    fileprivate func centredScale(_ factor: CGFloat) -> CATransform3D {
        let dx = bounds.width * (0.5 - anchorPoint.x)
        let dy = bounds.height * (0.5 - anchorPoint.y)
        let scaled = CATransform3DScale(CATransform3DMakeTranslation(dx, dy, 0), factor, factor, 1)
        return CATransform3DTranslate(scaled, -dx, -dy, 0)
    }
}
