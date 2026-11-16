import CaretMenubarCore
import Foundation

extension URLSession {
    /// Sends `request` to the daemon and reports what came back. Any failure to get an HTTP
    /// answer is `.noResponse`.
    /// - Throws: `CancellationError` when the task is cancelled.
    func outcome(of request: URLRequest) async throws -> PollOutcome {
        do {
            let (data, response) = try await data(for: request)
            return (response as? HTTPURLResponse).map {
                .response(status: $0.statusCode, body: data)
            } ?? .noResponse
        } catch is CancellationError, URLError.cancelled {
            throw CancellationError()
        } catch {
            return .noResponse
        }
    }
}
