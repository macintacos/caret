// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "CaretMenubar",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "CaretMenubarCore"),
        .executableTarget(name: "CaretMenubar", dependencies: ["CaretMenubarCore"]),
        .testTarget(name: "CaretMenubarCoreTests", dependencies: ["CaretMenubarCore"]),
    ]
)
