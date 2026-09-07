import Core
import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Turns every non-2xx answer into an `APIError` from the 001 error envelope (plan.md Shared Semantics 12), so the
/// adapters only handle success cases and every feature sees one error type. Listed first (outermost) so it sees
/// the final response after `AuthMiddleware`'s retry.
public struct ErrorEnvelopeMiddleware: ClientMiddleware {
    /// Error bodies are small; anything bigger is not an envelope.
    public static let maxBodyBytes = 64 * 1024

    public init() {}

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let (response, responseBody) = try await next(request, body, baseURL)
        let status = response.status.code
        guard status >= 400 else {
            return (response, responseBody)
        }
        throw await Self.error(status: status, body: responseBody, retryAfter: response.headerFields[.retryAfter])
    }

    static func error(status: Int, body: HTTPBody?, retryAfter: String?) async -> APIError {
        var data = Data()
        if let body {
            data = (try? await Data(collecting: body, upTo: maxBodyBytes)) ?? Data()
        }
        if let envelope = try? JSONCoding.decoder().decode(ErrorEnvelope.self, from: data) {
            var error = APIError(envelope: envelope, status: status)
            if case .rateLimited(nil) = error, let retryAfter, let seconds = Int(retryAfter) {
                error = .rateLimited(retryAfterS: seconds)
            }
            return error
        }
        return .unexpected(code: "HTTP_\(status)", status: status)
    }
}
