import Core
import Foundation
import Observation

/// State of the Profile tab and its sub-flows (spec US3/US5/US6): the profile, the display-name form (validated
/// with `DisplayNameValidator` before anything reaches the API), sign-out, deletion (the local session is cleared
/// once the request reached the server — plan.md Shared Semantics 11) and the export poll (`ExportPresentation`).
@Observable
@MainActor
public final class ProfileViewModel {
    public enum Phase: Equatable, Sendable {
        case loading
        case loaded
        case failed(message: String)
    }

    /// Injected so tests do not wait 5 s per poll.
    public typealias Sleeper = @Sendable (Duration) async throws -> Void

    public private(set) var phase: Phase = .loading
    public private(set) var me: Me?
    public private(set) var factions: FactionsResponse?
    public private(set) var export: ExportPresentation = .idle
    public private(set) var isSavingName = false
    public private(set) var isSigningOut = false
    public private(set) var isDeleting = false
    public private(set) var errorMessage: String?
    /// Bound to the edit form's text field.
    public var displayNameDraft = ""

    private let profileService: any ProfileService
    private let factionsService: (any FactionsService)?
    private let session: AuthSession
    private let clock: any Clock
    private let sleeper: Sleeper
    private let onMeChanged: @MainActor @Sendable (Me?) -> Void

    public init(
        profile: any ProfileService,
        factions: (any FactionsService)? = nil,
        session: AuthSession,
        clock: any Clock = SystemClock(),
        me: Me? = nil,
        sleeper: @escaping Sleeper = { try await Task.sleep(for: $0) },
        onMeChanged: @escaping @MainActor @Sendable (Me?) -> Void = { _ in }
    ) {
        profileService = profile
        factionsService = factions
        self.session = session
        self.clock = clock
        self.me = me
        self.sleeper = sleeper
        self.onMeChanged = onMeChanged
        if me != nil { phase = .loaded }
    }

    // MARK: Profile

    public var currentFaction: Faction? { factions?.faction(id: me?.factionId) }

    public func load() async {
        errorMessage = nil
        if me == nil { phase = .loading }
        async let factionsAnswer = factionsService?.factions()
        do {
            let fresh = try await profileService.me()
            me = fresh
            onMeChanged(fresh)
            phase = .loaded
        } catch {
            // Keep a previously loaded profile (offline); only an empty screen reports the failure.
            if me == nil { phase = .failed(message: Self.message(for: error)) } else { errorMessage = Self.message(for: error) }
        }
        if let answer = try? await factionsAnswer {
            factions = answer
        }
    }

    // MARK: Display name

    public var draftValidation: Result<String, DisplayNameError> { DisplayNameValidator.validate(displayNameDraft) }

    public var draftError: DisplayNameError? {
        if case let .failure(error) = draftValidation { return error }
        return nil
    }

    public var draftScalarCount: Int { DisplayNameValidator.scalarCount(DisplayNameValidator.trim(displayNameDraft)) }

    public var canSaveDraft: Bool {
        guard !isSavingName, case let .success(trimmed) = draftValidation else { return false }
        return trimmed != me?.displayName
    }

    public func beginEditingName() {
        displayNameDraft = me?.displayName ?? ""
        errorMessage = nil
    }

    /// Validates locally first; an invalid draft never reaches the service.
    @discardableResult
    public func saveDisplayName() async -> Bool {
        guard case let .success(trimmed) = draftValidation, !isSavingName else { return false }
        isSavingName = true
        errorMessage = nil
        defer { isSavingName = false }
        do {
            let updated = try await profileService.updateDisplayName(trimmed)
            me = updated
            onMeChanged(updated)
            return true
        } catch {
            errorMessage = Self.message(for: error)
            return false
        }
    }

    // MARK: Sign out / delete

    public func signOut() async {
        isSigningOut = true
        defer { isSigningOut = false }
        await session.signOut()
        onMeChanged(nil)
    }

    /// `DELETE /v1/me`, then the local session is cleared — also when the response could not be read (the server
    /// has already revoked every token). Only a transport failure (the request never arrived) keeps the session.
    @discardableResult
    public func deleteAccount() async -> Bool {
        isDeleting = true
        errorMessage = nil
        defer { isDeleting = false }
        do {
            _ = try await profileService.deleteAccount()
        } catch let APIError.network(underlying) {
            errorMessage = APIError.network(underlying: underlying).userMessage
            return false
        } catch {
            // Deleted on the server (or the session was already gone): clear locally regardless of the body.
        }
        await session.clearLocalSession()
        onMeChanged(nil)
        return true
    }

    // MARK: Export

    /// Polls `GET /v1/me/export` every 5 s until ready, failed or the 5-minute budget is spent.
    public func requestExport() async {
        export = export.started(at: clock.now())
        while true {
            do {
                let status = try await profileService.export()
                export = export.receiving(status, at: clock.now())
            } catch {
                export = export.failing(error)
            }
            guard export.isPolling, !Task.isCancelled else { return }
            do {
                try await sleeper(.seconds(ExportPresentation.pollInterval))
            } catch {
                return // cancelled while sleeping; the state stays pending and the screen offers "Check again"
            }
        }
    }

    public func resetExport() {
        export = .idle
    }

    private static func message(for error: any Error) -> String {
        (error as? APIError ?? APIError.network(underlying: error)).userMessage
    }
}
