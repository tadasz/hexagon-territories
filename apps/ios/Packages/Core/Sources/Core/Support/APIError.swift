import Foundation

/// The API's error envelope (feature 001; repeated in `contracts/openapi.yaml` as `Error`).
public struct ErrorEnvelope: Codable, Sendable, Equatable {
    public struct Body: Codable, Sendable, Equatable {
        public var code: String
        public var message: String
        public var details: [String: JSONValue]?

        public init(code: String, message: String, details: [String: JSONValue]? = nil) {
            self.code = code
            self.message = message
            self.details = details
        }
    }

    public var error: Body
    public var requestId: String?

    public init(error: Body, requestId: String? = nil) {
        self.error = error
        self.requestId = requestId
    }
}

/// Client-side view of every non-2xx answer (data-model.md §6). Unknown codes map to `.unexpected` (plan.md Shared
/// Semantics 12); transport failures to `.network`.
public enum APIError: Error, Sendable {
    case unauthorized
    case tokenExpired
    case accountDeleted
    case invalidAppleToken(reason: String?)
    case appleUnavailable
    case invalidRefreshToken
    case refreshReused
    case factionNotFound
    case factionChangeLocked(nextChangeAt: Date)
    case rateLimited(retryAfterS: Int?)
    case validation(message: String)
    case network(underlying: any Error)
    case unexpected(code: String, status: Int)

    /// Maps an envelope's `code` (plus HTTP status and `details`) to a case. `FACTION_CHANGE_LOCKED` without a
    /// parseable `details.nextChangeAt` is reported as `.unexpected` rather than inventing a date.
    public init(code: String, status: Int, details: [String: JSONValue]? = nil, message: String = "") {
        switch code {
        case "UNAUTHORIZED": self = .unauthorized
        case "TOKEN_EXPIRED": self = .tokenExpired
        case "ACCOUNT_DELETED": self = .accountDeleted
        case "INVALID_APPLE_TOKEN": self = .invalidAppleToken(reason: details?["reason"]?.stringValue)
        case "APPLE_UNAVAILABLE": self = .appleUnavailable
        case "INVALID_REFRESH_TOKEN": self = .invalidRefreshToken
        case "REFRESH_REUSED": self = .refreshReused
        case "FACTION_NOT_FOUND": self = .factionNotFound
        case "FACTION_CHANGE_LOCKED":
            if let raw = details?["nextChangeAt"]?.stringValue, let date = JSONCoding.parseISO8601(raw) {
                self = .factionChangeLocked(nextChangeAt: date)
            } else {
                self = .unexpected(code: code, status: status)
            }
        case "RATE_LIMITED": self = .rateLimited(retryAfterS: details?["retryAfterS"]?.intValue)
        case "VALIDATION_FAILED": self = .validation(message: message)
        default: self = .unexpected(code: code, status: status)
        }
    }

    public init(envelope: ErrorEnvelope, status: Int) {
        self.init(
            code: envelope.error.code,
            status: status,
            details: envelope.error.details,
            message: envelope.error.message
        )
    }

    /// True for the 401 family that means "sign in again": the session clears the token store on these
    /// (plan.md Shared Semantics 2–4).
    public var endsSession: Bool {
        switch self {
        case .unauthorized, .tokenExpired, .accountDeleted, .invalidRefreshToken, .refreshReused: true
        default: false
        }
    }

    /// The envelope code, when the case came from one.
    public var code: String? {
        switch self {
        case .unauthorized: "UNAUTHORIZED"
        case .tokenExpired: "TOKEN_EXPIRED"
        case .accountDeleted: "ACCOUNT_DELETED"
        case .invalidAppleToken: "INVALID_APPLE_TOKEN"
        case .appleUnavailable: "APPLE_UNAVAILABLE"
        case .invalidRefreshToken: "INVALID_REFRESH_TOKEN"
        case .refreshReused: "REFRESH_REUSED"
        case .factionNotFound: "FACTION_NOT_FOUND"
        case .factionChangeLocked: "FACTION_CHANGE_LOCKED"
        case .rateLimited: "RATE_LIMITED"
        case .validation: "VALIDATION_FAILED"
        case .network: nil
        case let .unexpected(code, _): code
        }
    }

    /// Short player-facing text (spec: `message` from the server is never shown verbatim).
    public var userMessage: String {
        switch self {
        case .unauthorized, .tokenExpired, .invalidRefreshToken, .refreshReused:
            "Your session has ended. Please sign in again."
        case .accountDeleted:
            "This account was deleted. Sign in again to restore it within 30 days."
        case .invalidAppleToken:
            "Apple could not confirm your identity. Please try again."
        case .appleUnavailable:
            "Apple's sign-in service is unavailable right now. Please try again in a moment."
        case .factionNotFound:
            "That faction does not exist."
        case .factionChangeLocked:
            "You changed faction recently. Try again after the lock ends."
        case let .rateLimited(retryAfterS):
            if let retryAfterS {
                "Too many attempts. Try again in \(retryAfterS) seconds."
            } else {
                "Too many attempts. Try again shortly."
            }
        case .validation:
            "Some of the details are not valid."
        case .network:
            "Cannot reach Nature Explorer. Check your connection and try again."
        case .unexpected:
            "Something went wrong. Please try again."
        }
    }
}

extension APIError: Equatable {
    public static func == (lhs: APIError, rhs: APIError) -> Bool {
        switch (lhs, rhs) {
        case (.unauthorized, .unauthorized), (.tokenExpired, .tokenExpired), (.accountDeleted, .accountDeleted),
             (.appleUnavailable, .appleUnavailable), (.invalidRefreshToken, .invalidRefreshToken),
             (.refreshReused, .refreshReused), (.factionNotFound, .factionNotFound):
            true
        case let (.invalidAppleToken(a), .invalidAppleToken(b)): a == b
        case let (.factionChangeLocked(a), .factionChangeLocked(b)): a == b
        case let (.rateLimited(a), .rateLimited(b)): a == b
        case let (.validation(a), .validation(b)): a == b
        case let (.network(a), .network(b)): String(describing: a) == String(describing: b)
        case let (.unexpected(codeA, statusA), .unexpected(codeB, statusB)): codeA == codeB && statusA == statusB
        default: false
        }
    }
}
