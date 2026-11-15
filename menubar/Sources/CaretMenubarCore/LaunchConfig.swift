import Foundation

/// The three launch arguments, with the URLs' defaults.
package struct LaunchConfig: Equatable, Sendable {
    package let baseURL: URL
    package let reviewURL: URL
    package let tokenFile: String?

    package var pendingURL: URL { baseURL.appending(path: "api/pending") }

    /// Reads `--base-url`, `--review-url` and `--token-file`, each followed by its value.
    /// Arguments that don't start with `--` are AppKit's or launchd's, and are left alone.
    package init(arguments: some Sequence<String>) throws {
        // Defaults mirror DEFAULT_PORT and VANITY_HOST; contract.json pins both sides.
        var baseURL = URL(string: "http://127.0.0.1:42718")!
        var reviewURL = URL(string: "http://caret.localhost:42718")!
        var tokenFile: String?
        var rest = Array(arguments)[...]
        while let flag = rest.popFirst() {
            guard flag.hasPrefix("--") else { continue }
            guard let value = rest.popFirst() else {
                throw LaunchConfigError.missingValue(flag: flag)
            }
            switch flag {
            case "--base-url": baseURL = try Self.loopbackURL(value)
            case "--review-url": reviewURL = try Self.webURL(value)
            case "--token-file": tokenFile = value
            default: throw LaunchConfigError.unknownFlag(flag)
            }
        }
        self.baseURL = baseURL
        self.reviewURL = reviewURL
        self.tokenFile = tokenFile
    }

    /// The `GET /api/pending` request the icon polls with.
    package func pendingRequest() -> URLRequest { authorizedRequest(pendingURL) }

    /// The `GET /api/stats` request the menu sends as it opens.
    package func statsRequest() -> URLRequest {
        authorizedRequest(baseURL.appending(path: "api/stats"))
    }

    /// A request to `url`, carrying the daemon token when the token file has one. The file is
    /// re-read on every call, so a token the daemon rotates is picked up.
    private func authorizedRequest(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        if let token = tokenFile.flatMap(Self.token(atPath:)) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    /// Trimmed like `readToken` in src/daemon/token.ts; nil when missing or empty.
    static func token(atPath path: String) -> String? {
        guard let contents = try? String(contentsOfFile: path, encoding: .utf8) else { return nil }
        let token = contents.trimmingCharacters(in: .whitespacesAndNewlines)
        return token.isEmpty ? nil : token
    }

    static func isWebURL(_ url: URL) -> Bool {
        ["http", "https"].contains(url.scheme?.lowercased() ?? "")
    }

    /// Loopback is 127.0.0.0/8, ::1 and localhost; contract.json pins it to `isExposed` in
    /// src/daemon/address.ts.
    static func isLoopback(_ host: String) -> Bool {
        let host = host.lowercased()
        return host == "localhost" || host == "::1" || host == "[::1]"
            || host.wholeMatch(of: /127\.\d+\.\d+\.\d+/) != nil
    }

    private static func webURL(_ value: String) throws -> URL {
        guard let url = URL(string: value), isWebURL(url), url.host() != nil else {
            throw LaunchConfigError.invalidURL(value)
        }
        return url
    }

    private static func loopbackURL(_ value: String) throws -> URL {
        let url = try webURL(value)
        guard let host = url.host(), isLoopback(host) else {
            throw LaunchConfigError.notLoopback(value)
        }
        return url
    }
}

/// Why the launch arguments were refused; `description` is the message printed after
/// `caret-menubar:`.
package enum LaunchConfigError: Error, Equatable, CustomStringConvertible {
    case missingValue(flag: String)
    case unknownFlag(String)
    case invalidURL(String)
    case notLoopback(String)

    package var description: String {
        switch self {
        case let .missingValue(flag): "\(flag) needs a value"
        case let .unknownFlag(flag): "unknown flag \(flag)"
        case let .invalidURL(value): "not an http or https URL with a host: \(value)"
        case let .notLoopback(value): "the base URL must be loopback, not \(value)"
        }
    }
}
