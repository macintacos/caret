import Foundation
import Testing
@testable import CaretMenubarCore

@Test("no arguments gives the default URLs and no token file")
func defaults() throws {
    let config = try parseLaunchArguments([])
    #expect(config.baseURL.absoluteString == "http://127.0.0.1:42718")
    #expect(config.reviewURL.absoluteString == "http://caret.localhost:42718")
    #expect(config.tokenFile == nil)
    #expect(config.pendingURL.absoluteString == "http://127.0.0.1:42718/api/pending")
}

@Test("all three flags are read, and AppKit's own arguments are left alone")
func flags() throws {
    let config = try parseLaunchArguments([
        "-NSDocumentRevisionsDebugMode", "YES",
        "--base-url", "http://localhost:4000",
        "--review-url", "https://caret.example.com",
        "--token-file", "/tmp/daemon.token",
    ])
    #expect(config.pendingURL.absoluteString == "http://localhost:4000/api/pending")
    #expect(config.reviewURL.absoluteString == "https://caret.example.com")
    #expect(config.tokenFile == "/tmp/daemon.token")
}

@Test("a loopback base URL is accepted", arguments: [
    "http://127.0.0.1:42718", "http://127.3.2.1:9", "http://localhost:42718", "http://[::1]:42718",
])
func loopbackBase(url: String) throws {
    #expect(try parseLaunchArguments(["--base-url", url]).baseURL.absoluteString == url)
}

@Test("a base URL that isn't loopback is refused", arguments: [
    "http://192.168.1.10:42718", "http://caret.localhost:42718", "http://example.com",
])
func remoteBase(url: String) {
    #expect(throws: LaunchConfigError.notLoopback(url)) { try parseLaunchArguments(["--base-url", url]) }
}

@Test("bad arguments are refused")
func refusals() {
    #expect(throws: LaunchConfigError.missingValue(flag: "--token-file")) {
        try parseLaunchArguments(["--token-file"])
    }
    #expect(throws: LaunchConfigError.unknownFlag("--base-urll")) {
        try parseLaunchArguments(["--base-urll", "http://127.0.0.1:42718"])
    }
    #expect(throws: LaunchConfigError.invalidURL("file:///etc/passwd")) {
        try parseLaunchArguments(["--base-url", "file:///etc/passwd"])
    }
}

@Test("only http and https URLs open")
func webURLs() {
    #expect(isWebURL(URL(string: "http://caret.localhost:42718")!))
    #expect(isWebURL(URL(string: "HTTPS://caret.example.com")!))
    #expect(!isWebURL(URL(string: "file:///Applications")!))
    #expect(!isWebURL(URL(string: "javascript:alert(1)")!))
}
