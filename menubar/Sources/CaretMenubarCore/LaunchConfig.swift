import Foundation

/// The three launch arguments, with the URLs' defaults.
public struct LaunchConfig: Equatable, Sendable {
    public var baseURL = URL(string: "http://127.0.0.1:42718")!
    public var reviewURL = URL(string: "http://caret.localhost:42718")!
    public var tokenFile: String?

    public var pendingURL: URL { baseURL.appendingPathComponent("api/pending") }
}

public enum LaunchConfigError: Error, Equatable, CustomStringConvertible {
    case missingValue(flag: String)
    case unknownFlag(String)
    case invalidURL(String)
    case notLoopback(String)

    public var description: String {
        switch self {
        case let .missingValue(flag): "\(flag) needs a value"
        case let .unknownFlag(flag): "unknown flag \(flag)"
        case let .invalidURL(value): "not an http or https URL: \(value)"
        case let .notLoopback(value): "the base URL must be loopback, not \(value)"
        }
    }
}

/// Reads `--base-url`, `--review-url` and `--token-file`, each followed by its value. Arguments
/// that don't start with `--` are AppKit's or launchd's, and are left alone.
public func parseLaunchArguments(_ arguments: [String]) throws -> LaunchConfig {
    var config = LaunchConfig()
    var rest = arguments[...]
    while let flag = rest.popFirst() {
        guard flag.hasPrefix("--") else { continue }
        guard let value = rest.popFirst() else { throw LaunchConfigError.missingValue(flag: flag) }
        switch flag {
        case "--base-url": config.baseURL = try loopbackURL(value)
        case "--review-url": config.reviewURL = try webURL(value)
        case "--token-file": config.tokenFile = value
        default: throw LaunchConfigError.unknownFlag(flag)
        }
    }
    return config
}

public func isWebURL(_ url: URL) -> Bool {
    ["http", "https"].contains(url.scheme?.lowercased() ?? "")
}

/// Loopback is 127.0.0.0/8, ::1 and localhost. Keep in sync with `isExposed` in
/// src/daemon/address.ts.
func isLoopback(_ host: String) -> Bool {
    host == "localhost" || host == "::1" || host == "[::1]"
        || host.range(of: #"^127\.\d+\.\d+\.\d+$"#, options: .regularExpression) != nil
}

private func webURL(_ value: String) throws -> URL {
    guard let url = URL(string: value), isWebURL(url), url.host != nil else {
        throw LaunchConfigError.invalidURL(value)
    }
    return url
}

private func loopbackURL(_ value: String) throws -> URL {
    let url = try webURL(value)
    guard let host = url.host, isLoopback(host) else { throw LaunchConfigError.notLoopback(value) }
    return url
}
