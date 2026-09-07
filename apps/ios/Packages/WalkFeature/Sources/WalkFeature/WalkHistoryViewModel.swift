import Core
import Foundation
import H3Kit
import Observation
import Persistence

/// The walk history (spec US4; plan.md Shared Semantics 9): the server's pages (newest first, "load more" by
/// cursor) with the local walks that are not synced yet merged on top, and the detail of one walk.
@Observable
@MainActor
public final class WalkHistoryViewModel {
    public private(set) var rows: [WalkRow] = []
    public private(set) var isLoading = false
    public private(set) var isLoadingMore = false
    public private(set) var errorMessage: String?
    public private(set) var hasLoaded = false
    private var nextCursor: String?

    private let service: any WalksService
    private let repository: any WalkRepository
    private let pageSize: Int

    public init(service: any WalksService, repository: any WalkRepository, pageSize: Int = 20) {
        self.service = service
        self.repository = repository
        self.pageSize = pageSize
    }

    public var canLoadMore: Bool { nextCursor != nil && !isLoadingMore }

    /// Local pending/failed walks first, then the first server page. A server failure keeps the local rows.
    public func load() async {
        isLoading = true
        errorMessage = nil
        defer {
            isLoading = false
            hasLoaded = true
        }
        let local = localRows()
        do {
            let page = try await service.listWalks(cursor: nil, limit: pageSize)
            nextCursor = page.nextCursor
            rows = Self.merge(local: local, server: page.items.map(WalkRow.init(item:)))
        } catch {
            nextCursor = nil
            rows = local
            errorMessage = Self.message(for: error)
        }
    }

    public func loadMore() async {
        guard let cursor = nextCursor, !isLoadingMore else { return }
        isLoadingMore = true
        defer { isLoadingMore = false }
        do {
            let page = try await service.listWalks(cursor: cursor, limit: pageSize)
            nextCursor = page.nextCursor
            let known = Set(rows.map(\.clientWalkId))
            rows += page.items.map(WalkRow.init(item:)).filter { !known.contains($0.clientWalkId) }
        } catch {
            errorMessage = Self.message(for: error)
        }
    }

    /// The full summary: from the server for synced walks (`WALK_NOT_FOUND` → "not available"), from the local
    /// store otherwise (the estimate while pending, the stored server summary when synced offline).
    public func detail(for row: WalkRow) async -> WalkSummaryPresentation? {
        if row.isLocal, let local = try? repository.localWalk(id: row.clientWalkId) {
            let path = (try? repository.path(for: local.id)) ?? []
            if local.summary != nil || local.serverId == nil || !local.isSynced {
                return WalkSummaryPresentation(local: local, path: path)
            }
        }
        guard let serverId = row.serverId else { return nil }
        do {
            var presentation = WalkSummaryPresentation(server: try await service.walk(id: serverId))
            if presentation.path.isEmpty, let localPath = try? repository.path(for: row.clientWalkId), !localPath.isEmpty {
                presentation.path = localPath
            }
            return presentation
        } catch {
            errorMessage = Self.message(for: error)
            return nil
        }
    }

    // MARK: Private

    private func localRows() -> [WalkRow] {
        ((try? repository.unsyncedWalks()) ?? []).map { walk in
            WalkRow(local: walk, path: (try? repository.path(for: walk.id)) ?? [])
        }
    }

    static func merge(local: [WalkRow], server: [WalkRow]) -> [WalkRow] {
        let localIds = Set(local.map(\.clientWalkId))
        return local + server.filter { !localIds.contains($0.clientWalkId) }
    }

    private static func message(for error: any Error) -> String {
        (error as? APIError ?? APIError.network(underlying: error)).userMessage
    }
}
