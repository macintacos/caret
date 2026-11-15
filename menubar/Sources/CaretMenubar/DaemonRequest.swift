import CaretMenubarCore
import Foundation

extension URLSession {
    /// Sends `request` to the daemon and reports what came back. Any failure to get an HTTP
    /// answer, cancellation included, is `.noResponse`.
    func outcome(of request: URLRequest) async -> PollOutcome {
        do {
            let (data, response) = try await data(for: request)
            return (response as? HTTPURLResponse).map {
                .response(status: $0.statusCode, body: data)
            } ?? .noResponse
        } catch {
            return .noResponse
        }
    }
}
