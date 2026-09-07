import Foundation

/// The five walk endpoints (`contracts/openapi.yaml`, tag `walks`), all behind the bearer session. Implemented by
/// `APIClient.WalksServiceLive`; consumed only by `Persistence.SyncCoordinator` (outbox drain) and the history screen.
public protocol WalksService: Sendable {
    /// `POST /v1/walks` — idempotent on `clientWalkId` (201 and 200 both map to the same value).
    func createWalk(_ request: WalkCreateRequest) async throws -> WalkCreated
    /// `POST /v1/walks/{id}/samples` — store only, idempotent by `(walkId, seq)`.
    func uploadSamples(walkId: String, _ batch: SampleBatchRequest) async throws -> SampleBatchResult
    /// `POST /v1/walks/{id}/finish` — the only scoring path; repeating it returns the stored summary.
    func finishWalk(walkId: String, _ request: WalkFinishRequest) async throws -> WalkSummary
    /// `GET /v1/walks?cursor&limit` — the caller's walks, newest first.
    func listWalks(cursor: String?, limit: Int?) async throws -> WalkListPage
    /// `GET /v1/walks/{id}` — owner only (`WALK_NOT_FOUND` otherwise).
    func walk(id: String) async throws -> WalkSummary
}
