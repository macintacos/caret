import Foundation
import Testing

@testable import CaretMenubarCore

/// Facts the TypeScript side holds too; test/core/daemon/menubar-contract.test.ts reads the same file.
private struct Contract: Decodable {
    struct Defaults: Decodable {
        let baseURL: String
        let reviewURL: String
    }
    let defaults: Defaults
    let flags: [String]
    let loopbackHosts: [String]
    let exposedHosts: [String]
    let pendingBody: [String: Int]
    let accent: [String: String]

    static let url = URL(filePath: #filePath).deletingLastPathComponent()
        .appending(path: "contract.json")

    static func load() throws -> Contract {
        try JSONDecoder().decode(Contract.self, from: Data(contentsOf: url))
    }
}

@Test("the default URLs match the daemon's defaults")
func contractDefaults() throws {
    let contract = try Contract.load()
    let config = try LaunchConfig(arguments: [])
    #expect(config.baseURL.absoluteString == contract.defaults.baseURL)
    #expect(config.reviewURL.absoluteString == contract.defaults.reviewURL)
}

@Test("every flag the plist passes is read")
func contractFlags() throws {
    let contract = try Contract.load()
    let values = [
        "--base-url": "http://127.0.0.1:1", "--review-url": "http://127.0.0.1:2",
        "--token-file": "/tmp/t",
    ]
    #expect(Set(contract.flags) == Set(values.keys))
    let config = try LaunchConfig(arguments: contract.flags.flatMap { [$0, values[$0]!] })
    #expect(config.baseURL.absoluteString == "http://127.0.0.1:1")
    #expect(config.reviewURL.absoluteString == "http://127.0.0.1:2")
    #expect(config.tokenFile == "/tmp/t")
}

@Test("the loopback rule agrees with the daemon's")
func contractLoopback() throws {
    let contract = try Contract.load()
    for host in contract.loopbackHosts { #expect(LaunchConfig.isLoopback(host), "\(host)") }
    for host in contract.exposedHosts { #expect(!LaunchConfig.isLoopback(host), "\(host)") }
}

@Test("the daemon's pending body decodes to its count")
func contractPendingBody() throws {
    let body = try JSONEncoder().encode(try Contract.load().pendingBody)
    #expect(IconState(.response(status: 200, body: body)) == .pending)
}

@Test("the daemon's stats body decodes to its version, tally and accent")
func contractStatsBody() throws {
    let contract = try JSONSerialization.jsonObject(with: Data(contentsOf: Contract.url))
    let fields = try #require((contract as? [String: Any])?["statsBody"] as? [String: Any])
    let accent = try #require(fields["accent"] as? [String: String])
    let expected = ReviewStats(
        version: try #require(fields["version"] as? String),
        approved: try #require(fields["approved"] as? Int),
        rejected: try #require(fields["rejected"] as? Int),
        revisions: try #require(fields["revisions"] as? Int),
        comments: try #require(fields["comments"] as? Int),
        accent: Accent(light: try rgb(accent["light"]), dark: try rgb(accent["dark"])))
    let body = try JSONSerialization.data(withJSONObject: fields)
    #expect(CardState(.response(status: 200, body: body)) == .stats(expected))
}

private func rgb(_ hex: String?) throws -> Int {
    try #require(hex.flatMap { Int($0.dropFirst(), radix: 16) })
}

@Test("the card's default tint is caret's own accent in both appearances")
func contractAccent() throws {
    let accent = try Contract.load().accent
    #expect(accent["light"] == hex(Accent.caret.light))
    #expect(accent["dark"] == hex(Accent.caret.dark))
}

private func hex(_ rgb: Int) -> String { String(format: "#%06x", rgb) }
