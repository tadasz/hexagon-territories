import Core
import Foundation
import Location
import Observation
import Persistence

/// State of the Walk tab (research.md R18): permission gate → `WalkTracker` start → live HUD from `LivePath` →
/// stop (or auto-end) → the walk's finish goes to the outbox → provisional summary → replaced by the server's
/// summary when `SyncCoordinator` delivers the finish. Every server interaction is queued; the screen never talks to
/// the network itself (Constitution VII).
@Observable
@MainActor
public final class WalkViewModel {
    public enum Phase: Sendable, Equatable {
        case idle
        case checkingPermission
        case permissionDenied(LocationAuthorization)
        case needsFaction
        case recording
        case paused
        case finishing
        case summary
        case failed(String)
    }

    public typealias Sleeper = @Sendable (TimeInterval) async throws -> Void

    /// How often the tracker is ticked while a walk runs (auto-pause without fixes, the 6 h auto-end).
    public static let tickInterval: TimeInterval = 15

    public private(set) var phase: Phase = .idle
    public let livePath: LivePath
    /// The finish sheet's content: the estimate right after Stop, the server's numbers once synced.
    public private(set) var summary: WalkSummaryPresentation?
    /// Why a walk ended on its own, when it did (auto-end, lost location access).
    public private(set) var notice: String?
    /// The local database is unavailable or failed mid-walk: the walk may not be saved.
    public private(set) var storeWarning: Bool
    public private(set) var pendingUploads = 0

    private let tracker: WalkTracker
    private let sync: SyncCoordinator
    private let permission: any LocationPermission
    private let hasFaction: @Sendable () -> Bool
    private let deviceInfo: DeviceInfo?
    private let clock: any Clock
    private let sleeper: Sleeper
    private var tickTask: Task<Void, Never>? {
        didSet { tasks.tick = tickTask }
    }
    /// Cancelled when the view model goes away (a nonisolated box, because `deinit` cannot touch actor state).
    private let tasks = TaskBox()

    public init(
        tracker: WalkTracker,
        livePath: LivePath,
        sync: SyncCoordinator,
        permission: any LocationPermission,
        hasFaction: @escaping @Sendable () -> Bool,
        deviceInfo: DeviceInfo? = nil,
        storeIsDurable: Bool = true,
        clock: any Clock = SystemClock(),
        sleeper: @escaping Sleeper = { try await Task.sleep(for: .seconds($0)) }
    ) {
        self.tracker = tracker
        self.livePath = livePath
        self.sync = sync
        self.permission = permission
        self.hasFaction = hasFaction
        self.deviceInfo = deviceInfo
        storeWarning = !storeIsDurable
        self.clock = clock
        self.sleeper = sleeper
        observe()
    }


    public var hud: HUDState { livePath.hud }
    public var isRecording: Bool { phase == .recording || phase == .paused }

    public var canStart: Bool {
        switch phase {
        case .idle, .summary, .failed, .permissionDenied, .needsFaction: true
        default: false
        }
    }

    // MARK: Actions

    /// Start: faction check → When-In-Use permission (asked once) → tracker → outbox `create` → timers.
    public func start() async {
        guard canStart else { return }
        notice = nil
        summary = nil
        guard hasFaction() else {
            phase = .needsFaction
            return
        }
        phase = .checkingPermission
        var status = permission.status()
        if status == .notDetermined {
            status = await permission.requestWhenInUse()
        }
        guard status.allowsWalk else {
            phase = .permissionDenied(status)
            return
        }
        await tracker.reset()
        let id = UUID().uuidString.lowercased()
        do {
            try await tracker.start(clientWalkId: id)
        } catch {
            phase = .failed(Self.message(for: error))
            return
        }
        let startedAt = await tracker.currentStartedAt ?? clock.now()
        do {
            try await sync.walkStarted(clientWalkId: id, startedAt: startedAt, deviceInfo: deviceInfo)
        } catch {
            storeWarning = true
        }
        await sync.startRecordingTimer(walkId: id)
        phase = .recording
        startTicking()
    }

    /// Stop: tracker → outbox `samples` + `finish` → provisional summary (replaced when synced).
    public func stop() async {
        guard isRecording else { return }
        phase = .finishing
        guard let input = await tracker.stop() else {
            phase = .idle
            return
        }
        await finished(input)
    }

    public func dismissSummary() {
        guard phase == .summary else { return }
        phase = .idle
        summary = nil
        notice = nil
    }

    /// Periodic tick (also callable by tests): drives auto-pause without fixes and the 6 h auto-end.
    public func handleTick() async {
        await tracker.tick()
    }

    /// At launch/foreground: a walk left recording by a kill is finished from the store and queued for upload
    /// (spec US1 scenario 7). Returns true when one was recovered; the summary sheet shows it as pending upload.
    @discardableResult
    public func recoverIfNeeded() async -> Bool {
        guard !isRecording, phase != .finishing else { return false }
        guard let input = try? await tracker.recover() else { return false }
        do {
            try await sync.walkFinished(input)
        } catch {
            storeWarning = true
        }
        notice = "A walk that was interrupted has been saved and will be uploaded."
        summary = WalkSummaryPresentation(provisional: ProvisionalSummary(input))
        phase = .summary
        pendingUploads = await sync.pendingCount()
        return true
    }

    // MARK: Private

    private func observe() {
        let tracker = self.tracker
        tasks.tracker = Task { [weak self] in
            for await state in tracker.stateChanges {
                guard let self else { return }
                await handle(state)
            }
        }
        let sync = self.sync
        tasks.sync = Task { [weak self] in
            for await event in sync.events {
                guard let self else { return }
                await handle(event)
            }
        }
    }

    private func handle(_ state: WalkTracker.State) async {
        switch state {
        case .paused where phase == .recording:
            phase = .paused
        case .recording where phase == .paused:
            phase = .recording
        case let .finished(input) where isRecording:
            // Auto-end or a lost source: `stop()` was not called, so finish the walk from here.
            phase = .finishing
            notice = input.reason == .autoEnd
                ? "Walks end automatically after 6 hours. This one has been saved."
                : "Location access ended, so the walk was stopped and saved."
            await finished(input)
        case .failed(.notAuthorized) where phase == .summary:
            notice = "Location access was turned off during the walk. Re-enable it in Settings before the next walk."
        default:
            break
        }
    }

    private func handle(_ event: SyncCoordinator.Event) async {
        let pending = await sync.pendingCount()
        switch event {
        case let .walkSynced(clientWalkId, serverSummary):
            if summary?.clientWalkId == clientWalkId {
                summary = WalkSummaryPresentation(server: serverSummary)
            }
        case let .walkFailed(clientWalkId, code):
            if summary?.clientWalkId == clientWalkId {
                summary?.uploadFailure = code
            }
        case .walkCreated, .drained:
            break
        }
        pendingUploads = pending
    }

    private func finished(_ input: WalkFinishInput) async {
        tickTask?.cancel()
        tickTask = nil
        do {
            try await sync.walkFinished(input)
        } catch {
            storeWarning = true
        }
        summary = WalkSummaryPresentation(provisional: ProvisionalSummary(input))
        phase = .summary
        pendingUploads = await sync.pendingCount()
    }

    private func startTicking() {
        tickTask?.cancel()
        let sleeper = self.sleeper
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                guard (try? await sleeper(Self.tickInterval)) != nil else { return }
                await self?.handleTick()
            }
        }
    }

    private static func message(for error: any Error) -> String {
        switch error as? WalkTracker.WalkFailure {
        case .notAuthorized: "Location access is needed to record a walk."
        case .sourceUnavailable: "Location is not available on this device right now."
        case .storeFailed: "The walk could not be saved on this device."
        case nil: (error as? APIError ?? APIError.network(underlying: error)).userMessage
        }
    }
}

/// Owns the view model's long-running tasks and cancels them when it is deallocated with the view model.
private final class TaskBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: [String: Task<Void, Never>] = [:]

    var tick: Task<Void, Never>? {
        get { lock.withLock { stored["tick"] } }
        set { lock.withLock { stored["tick"] = newValue } }
    }

    var tracker: Task<Void, Never>? {
        get { lock.withLock { stored["tracker"] } }
        set { lock.withLock { stored["tracker"] = newValue } }
    }

    var sync: Task<Void, Never>? {
        get { lock.withLock { stored["sync"] } }
        set { lock.withLock { stored["sync"] = newValue } }
    }

    deinit {
        stored.values.forEach { $0.cancel() }
    }
}
