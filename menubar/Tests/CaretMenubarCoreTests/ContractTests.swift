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

    static func load() throws -> Contract {
        let url = URL(filePath: #filePath).deletingLastPathComponent()
            .appending(path: "contract.json")
        return try JSONDecoder().decode(Contract.self, from: Data(contentsOf: url))
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
