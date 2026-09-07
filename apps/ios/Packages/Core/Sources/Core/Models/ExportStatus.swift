import Foundation

/// `pending → ready | failed` (plan.md Shared Semantics 10).
public enum ExportState: String, Codable, Sendable, Equatable {
    case pending
    case ready
    case failed
}

/// `GET /v1/me/export` (data-model.md §2.2). `downloadUrl` is a presigned GET valid for one hour, only when `ready`.
public struct ExportStatus: Codable, Sendable, Equatable, Identifiable {
    public let id: String
    public var status: ExportState
    public var requestedAt: Date
    public var completedAt: Date?
    public var expiresAt: Date?
    public var downloadUrl: String?
    public var error: String?

    public init(
        id: String,
        status: ExportState,
        requestedAt: Date,
        completedAt: Date?,
        expiresAt: Date?,
        downloadUrl: String?,
        error: String?
    ) {
        self.id = id
        self.status = status
        self.requestedAt = requestedAt
        self.completedAt = completedAt
        self.expiresAt = expiresAt
        self.downloadUrl = downloadUrl
        self.error = error
    }

    /// `downloadUrl` parsed, when present and well-formed.
    public var downloadURL: URL? {
        guard let downloadUrl else { return nil }
        return URL(string: downloadUrl)
    }
}
