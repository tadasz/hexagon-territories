import Foundation
import Persistence

/// The app-level kicks of the outbox drain (research.md R17): connectivity returning (`NWPathMonitor`) and the
/// background refresh window (`BGAppRefreshTask`, identifier `com.natureexplorer.app.sync`). Foreground kicks come
/// from `NatureExplorerApp`'s scene-phase handler. Both frameworks are Apple-only, so the bodies are guarded.
final class SyncKicks: @unchecked Sendable {
    static let backgroundTaskIdentifier = "com.natureexplorer.app.sync"
    /// Ask for the next refresh no sooner than this (the system decides the actual time).
    static let refreshInterval: TimeInterval = 15 * 60

    private let sync: SyncCoordinator
    #if canImport(Network)
    private var monitor: NWPathMonitor?
    #endif

    init(sync: SyncCoordinator) {
        self.sync = sync
    }

    /// Registers the background task (must run before the app finishes launching) and starts the path monitor.
    func start() {
        registerBackgroundTask()
        startPathMonitor()
    }

    func scheduleBackgroundRefresh() {
        #if canImport(BackgroundTasks)
        let request = BGAppRefreshTaskRequest(identifier: Self.backgroundTaskIdentifier)
        request.earliestBeginDate = Date().addingTimeInterval(Self.refreshInterval)
        try? BGTaskScheduler.shared.submit(request)
        #endif
    }

    private func registerBackgroundTask() {
        #if canImport(BackgroundTasks)
        let sync = self.sync
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.backgroundTaskIdentifier, using: nil) { [weak self] task in
            self?.scheduleBackgroundRefresh()
            let work = Task {
                await sync.drain()
                task.setTaskCompleted(success: true)
            }
            task.expirationHandler = { work.cancel() }
        }
        #endif
    }

    private func startPathMonitor() {
        #if canImport(Network)
        let monitor = NWPathMonitor()
        let sync = self.sync
        monitor.pathUpdateHandler = { path in
            guard path.status == .satisfied else { return }
            Task { await sync.kick() }
        }
        monitor.start(queue: DispatchQueue(label: "com.natureexplorer.app.sync.path"))
        self.monitor = monitor
        #endif
    }
}

#if canImport(BackgroundTasks)
import BackgroundTasks
#endif
#if canImport(Network)
import Network
#endif
