/// How the menubar carrot animates when it changes colour.
package enum IconTransition: Equatable, Sendable {
    /// Grey to coloured: a plan is now waiting.
    case lightUp
    /// Coloured to grey: no plan waits any more.
    case dim
}

extension IconTransition {
    /// The transition from the icon shown to the next one, or nil when the carrot switches at
    /// once: on the first icon, when its colour stays the same, and under Reduce Motion.
    package init?(from old: IconState?, to new: IconState, reduceMotion: Bool) {
        guard !reduceMotion, let old, old.isColoured != new.isColoured else { return nil }
        self = new.isColoured ? .lightUp : .dim
    }
}
