import Foundation
import Testing

@testable import CaretMenubarCore

private func tokenFile(_ contents: String?) throws -> String {
    let path = FileManager.default.temporaryDirectory
        .appending(path: "caret-menubar-\(UUID().uuidString).token").path()
    if let contents { try contents.write(toFile: path, atomically: true, encoding: .utf8) }
    return path
}

private func authorization(tokenFile path: String) throws -> String? {
    try LaunchConfig(arguments: ["--token-file", path]).pendingRequest()
        .value(forHTTPHeaderField: "Authorization")
}

@Test("the request asks the base URL's /api/pending")
func pendingRequestURL() throws {
    let request = try LaunchConfig(arguments: ["--base-url", "http://127.0.0.1:4000"])
        .pendingRequest()
    #expect(request.url?.absoluteString == "http://127.0.0.1:4000/api/pending")
}

@Test("the token is sent trimmed as a bearer token")
func pendingRequestToken() throws {
    let path = try tokenFile("  abc123\n")
    defer { try? FileManager.default.removeItem(atPath: path) }
    #expect(try authorization(tokenFile: path) == "Bearer abc123")
}

@Test("an empty or missing token file sends no Authorization header", arguments: ["", nil])
func pendingRequestNoToken(contents: String?) throws {
    let path = try tokenFile(contents)
    defer { try? FileManager.default.removeItem(atPath: path) }
    #expect(try authorization(tokenFile: path) == nil)
}
