import Core
import Foundation

/// Scriptable `ProfileService`. `updateDisplayNameResult` / `selectFactionResult` default to "apply the change to
/// `me`"; `exportResults` is a queue whose last element repeats.
public final class FakeProfileService: ProfileService, @unchecked Sendable {
    private struct State: Sendable {
        var me: Me
        var meError: (any Error)?
        var updateDisplayNameResult: Result<Me, any Error>?
        var selectFactionResult: Result<Me, any Error>?
        var deleteAccountResult: Result<AccountDeletion, any Error>
        var exportResults: [Result<ExportStatus, any Error>]
        var meCalls = 0
        var updateDisplayNameCalls: [String] = []
        var selectFactionCalls: [Int] = []
        var deleteAccountCalls = 0
        var exportCalls = 0
    }

    private let state: Locked<State>

    public init(
        me: Me = Fixtures.me(),
        deleteAccountResult: Result<AccountDeletion, any Error> = .success(Fixtures.accountDeletion()),
        exportResults: [Result<ExportStatus, any Error>] = [.success(Fixtures.exportStatus(.pending))]
    ) {
        state = Locked(State(
            me: me,
            deleteAccountResult: deleteAccountResult,
            exportResults: exportResults
        ))
    }

    public var currentMe: Me {
        get { state.value.me }
        set { state.withLock { $0.me = newValue } }
    }

    public var meError: (any Error)? {
        get { state.value.meError }
        set { state.withLock { $0.meError = newValue } }
    }

    public var updateDisplayNameResult: Result<Me, any Error>? {
        get { state.value.updateDisplayNameResult }
        set { state.withLock { $0.updateDisplayNameResult = newValue } }
    }

    public var selectFactionResult: Result<Me, any Error>? {
        get { state.value.selectFactionResult }
        set { state.withLock { $0.selectFactionResult = newValue } }
    }

    public var deleteAccountResult: Result<AccountDeletion, any Error> {
        get { state.value.deleteAccountResult }
        set { state.withLock { $0.deleteAccountResult = newValue } }
    }

    public var exportResults: [Result<ExportStatus, any Error>] {
        get { state.value.exportResults }
        set { state.withLock { $0.exportResults = newValue } }
    }

    public var meCalls: Int { state.value.meCalls }
    public var updateDisplayNameCalls: [String] { state.value.updateDisplayNameCalls }
    public var selectFactionCalls: [Int] { state.value.selectFactionCalls }
    public var deleteAccountCalls: Int { state.value.deleteAccountCalls }
    public var exportCalls: Int { state.value.exportCalls }

    public func me() async throws -> Me {
        let (me, error) = state.withLock { state -> (Me, (any Error)?) in
            state.meCalls += 1
            return (state.me, state.meError)
        }
        if let error { throw error }
        return me
    }

    public func updateDisplayName(_ displayName: String) async throws -> Me {
        let result = state.withLock { state -> Result<Me, any Error> in
            state.updateDisplayNameCalls.append(displayName)
            if let scripted = state.updateDisplayNameResult { return scripted }
            state.me.displayName = displayName
            return .success(state.me)
        }
        return try result.get()
    }

    public func selectFaction(_ factionId: Int) async throws -> Me {
        let result = state.withLock { state -> Result<Me, any Error> in
            state.selectFactionCalls.append(factionId)
            if let scripted = state.selectFactionResult { return scripted }
            state.me.factionId = factionId
            return .success(state.me)
        }
        return try result.get()
    }

    public func deleteAccount() async throws -> AccountDeletion {
        let result = state.withLock { state -> Result<AccountDeletion, any Error> in
            state.deleteAccountCalls += 1
            return state.deleteAccountResult
        }
        return try result.get()
    }

    public func export() async throws -> ExportStatus {
        let result = state.withLock { state -> Result<ExportStatus, any Error> in
            state.exportCalls += 1
            if state.exportResults.count > 1 {
                return state.exportResults.removeFirst()
            }
            return state.exportResults.first ?? .success(Fixtures.exportStatus(.pending))
        }
        return try result.get()
    }
}
