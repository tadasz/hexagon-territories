import Core
import Foundation
import Observation

/// State of the faction pick screen and the Factions tab (spec US2/US4). Loads `GET /v1/factions` and `GET /v1/me`,
/// exposes the `FactionPickPresentation` rows, and confirms through `POST /v1/me/faction`. The lock comes only from
/// the server (`Me.factionChangeAvailableAt` or the `409` answer) — plan.md Shared Semantics 5–6.
@Observable
@MainActor
public final class FactionsViewModel {
    public enum Phase: Equatable, Sendable {
        case loading
        case loaded
        case failed(message: String)
    }

    public private(set) var phase: Phase = .loading
    public private(set) var response: FactionsResponse?
    public private(set) var me: Me?
    public private(set) var selectedFactionId: Int?
    public private(set) var isConfirming = false
    public private(set) var errorMessage: String?

    private let factionsService: any FactionsService
    private let profileService: any ProfileService
    private let clock: any Clock
    private let onMeChanged: @MainActor @Sendable (Me) -> Void

    public init(
        factions: any FactionsService,
        profile: any ProfileService,
        clock: any Clock = SystemClock(),
        me: Me? = nil,
        onMeChanged: @escaping @MainActor @Sendable (Me) -> Void = { _ in }
    ) {
        factionsService = factions
        profileService = profile
        self.clock = clock
        self.me = me
        self.onMeChanged = onMeChanged
    }

    public var rows: [FactionRow] {
        guard let response else { return [] }
        return FactionPickPresentation.rows(response: response, me: me)
    }

    public var currentFaction: Faction? { response?.faction(id: me?.factionId) }
    public var selectedFaction: Faction? { response?.faction(id: selectedFactionId) }
    public var activeWindowDays: Int? { response?.activeWindowDays }
    public var lock: FactionChangeLock { FactionChangeLock(me: me, clock: clock) }
    public var lockMessage: String? { lock.message(relativeTo: clock.now()) }
    public var hasFaction: Bool { me?.hasFaction ?? false }

    public var confirmEnabled: Bool {
        !isConfirming && FactionPickPresentation.confirmEnabled(
            selected: selectedFactionId,
            currentFactionId: me?.factionId,
            lock: lock
        )
    }

    /// Fetches the factions (required) and the profile (best effort: the injected `me` stays when it fails).
    public func load() async {
        phase = .loading
        errorMessage = nil
        async let factions = factionsService.factions()
        async let profile = profileService.me()
        do {
            response = try await factions
        } catch {
            phase = .failed(message: Self.message(for: error))
            _ = try? await profile
            return
        }
        if let fresh = try? await profile {
            me = fresh
        }
        if let response, selectedFactionId == nil || response.faction(id: selectedFactionId) == nil {
            selectedFactionId = FactionPickPresentation.preselectedFactionId(response: response, me: me)
        }
        phase = .loaded
    }

    public func select(_ factionId: Int) {
        guard response?.faction(id: factionId) != nil else { return }
        selectedFactionId = factionId
        errorMessage = nil
    }

    /// `POST /v1/me/faction`. Returns true when the profile now carries the selected faction.
    @discardableResult
    public func confirm() async -> Bool {
        guard let factionId = selectedFactionId, confirmEnabled else { return false }
        isConfirming = true
        errorMessage = nil
        defer { isConfirming = false }
        do {
            let updated = try await profileService.selectFaction(factionId)
            me = updated
            onMeChanged(updated)
            return true
        } catch let APIError.factionChangeLocked(nextChangeAt) {
            // The profile in memory was stale: adopt the server's lock so the UI disables the button.
            if var current = me {
                current.factionChangeAvailableAt = nextChangeAt
                me = current
                onMeChanged(current)
            }
            errorMessage = FactionChangeLock.locked(until: nextChangeAt).message(relativeTo: clock.now())
            return false
        } catch {
            errorMessage = Self.message(for: error)
            return false
        }
    }

    private static func message(for error: any Error) -> String {
        (error as? APIError ?? APIError.network(underlying: error)).userMessage
    }
}
