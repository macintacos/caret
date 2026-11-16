/// How the card's background meets the system's display settings.
package struct CardStyle: Equatable, Sendable {
    package enum Material: Equatable, Sendable {
        /// Liquid Glass, on macOS 26 and later.
        case glass
        /// The vibrant material menus wore before Liquid Glass.
        case vibrant
        /// A flat fill in place of a material, for Reduce Transparency.
        case solid
    }

    package let material: Material
    /// In points: none where glass draws its own edge, a hairline elsewhere, and a full
    /// point under Increase Contrast.
    package let borderWidth: Double

    package init(reduceTransparency: Bool, increaseContrast: Bool, hasLiquidGlass: Bool) {
        material =
            if reduceTransparency { .solid } else if hasLiquidGlass { .glass } else { .vibrant }
        borderWidth = if increaseContrast { 1 } else if material == .glass { 0 } else { 0.5 }
    }
}
