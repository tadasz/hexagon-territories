import Foundation

/// `DELETE /v1/me` (data-model.md §2.2): the account is soft-deleted at `deletedAt` and erased at `purgeAt`
/// (30 days later) unless the player signs in again before then.
public struct AccountDeletion: Codable, Sendable, Equatable {
    public var deletedAt: Date
    public var purgeAt: Date

    public init(deletedAt: Date, purgeAt: Date) {
        self.deletedAt = deletedAt
        self.purgeAt = purgeAt
    }
}
