// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "CaretMenubar",
    platforms: [.macOS(.v13)],
    targets: [
        .target(name: "CaretMenubarCore"),
        .executableTarget(
            name: "CaretMenubar",
            dependencies: ["CaretMenubarCore"],
            swiftSettings: [.defaultIsolation(MainActor.self)]
        ),
        .testTarget(
            name: "CaretMenubarCoreTests",
            dependencies: ["CaretMenubarCore"],
            exclude: ["contract.json"]
        ),
    ]
)
