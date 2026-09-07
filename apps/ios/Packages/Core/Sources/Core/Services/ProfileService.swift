import Foundation

/// The `/v1/me*` operations (authenticated).
public protocol ProfileService: Sendable {
    func me() async throws -> Me
    /// `PATCH /v1/me`; the caller validates with `DisplayNameValidator` first so invalid names never reach the API.
    func updateDisplayName(_ displayName: String) async throws -> Me
    /// `POST /v1/me/faction`; throws `APIError.factionChangeLocked(nextChangeAt:)` inside the 30-day lock.
    func selectFaction(_ factionId: Int) async throws -> Me
    /// `DELETE /v1/me`; the caller clears the local session regardless of the outcome (Shared Semantics 11).
    func deleteAccount() async throws -> AccountDeletion
    /// `GET /v1/me/export`: returns the current export or enqueues a new one (Shared Semantics 10).
    func export() async throws -> ExportStatus
}
