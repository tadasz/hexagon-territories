import Foundation

/// State machine behind the export screen (data-model.md §6; plan.md Shared Semantics 10): the client polls
/// `GET /v1/me/export` every 5 s while pending, for at most 5 minutes (60 polls), then shows "still preparing".
public enum ExportPresentation: Equatable, Sendable {
    case idle
    case pending(since: Date)
    case ready(url: URL, expiresAt: Date?)
    case failed(message: String)
    case timedOut

    public static let pollInterval: TimeInterval = 5
    public static let maxPolls = 60
    /// 5 s × 60 = 300 s.
    public static var pollBudget: TimeInterval { pollInterval * TimeInterval(maxPolls) }

    public static let timedOutMessage = "Your export is still being prepared. Come back later to download it."

    /// True while the screen should keep polling.
    public var isPolling: Bool {
        if case .pending = self { return true }
        return false
    }

    /// The player tapped "Export my data" (or "Try again"): polling starts now.
    public func started(at now: Date) -> ExportPresentation {
        .pending(since: now)
    }

    /// Applies one `ExportStatus` answer. A pending export stays pending until the budget is spent.
    public func receiving(_ status: ExportStatus, at now: Date) -> ExportPresentation {
        switch status.status {
        case .ready:
            guard let url = status.downloadURL else {
                return .failed(message: "The export is ready but no download link was provided.")
            }
            return .ready(url: url, expiresAt: status.expiresAt)
        case .failed:
            return .failed(message: status.error ?? "The export failed. Please try again.")
        case .pending:
            let since: Date = if case let .pending(since) = self { since } else { now }
            if now.timeIntervalSince(since) >= Self.pollBudget {
                return .timedOut
            }
            return .pending(since: since)
        }
    }

    /// A request threw (network or API error).
    public func failing(_ error: any Error) -> ExportPresentation {
        if let apiError = error as? APIError {
            return .failed(message: apiError.userMessage)
        }
        return .failed(message: APIError.network(underlying: error).userMessage)
    }
}
