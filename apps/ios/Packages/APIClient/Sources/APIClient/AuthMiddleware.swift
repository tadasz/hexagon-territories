import Core
import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Adds `Authorization: Bearer …` from the session and, on a `401`, asks the session to refresh once and retries the
/// request once (plan.md Shared Semantics 2). A second `401` is returned as is (the envelope middleware maps it).
/// Operations that need no session get no header and never trigger a refresh — `refreshTokens` in particular must
/// not, or a failing refresh would call back into the session that is waiting for it.
public struct AuthMiddleware: ClientMiddleware {
    /// `operationId`s of `contracts/openapi.yaml` with `security: []`.
    public static let publicOperations: Set<String> = ["signInWithApple", "refreshTokens", "listFactions"]

    private let tokens: any BearerTokenProvider

    public init(tokens: any BearerTokenProvider) {
        self.tokens = tokens
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        guard !Self.publicOperations.contains(operationID) else {
            return try await next(request, body, baseURL)
        }
        let token = try await tokens.validAccessToken()
        let (response, responseBody) = try await next(Self.authorised(request, token: token), body, baseURL)
        guard response.status == .unauthorized, Self.canReplay(body) else {
            return (response, responseBody)
        }
        let fresh = try await tokens.handleUnauthorized(failedAccessToken: token)
        return try await next(Self.authorised(request, token: fresh), body, baseURL)
    }

    private static func authorised(_ request: HTTPRequest, token: String) -> HTTPRequest {
        var request = request
        request.headerFields[.authorization] = "Bearer \(token)"
        return request
    }

    /// JSON bodies from the generated client are buffered and replayable; a streamed body could not be resent.
    private static func canReplay(_ body: HTTPBody?) -> Bool {
        guard let body else { return true }
        return body.iterationBehavior == .multiple
    }
}
