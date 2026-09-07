import SwiftUI

/// App entry point. The container is created once and injected into the environment; views read services from it
/// (`docs/architecture.md` §4: SwiftUI views → `@Observable` view models → protocol-typed services from `AppContainer`).
/// Feature 003 adds the outbox kicks: connectivity and background refresh (`SyncKicks`, registered at launch) and
/// the foreground scene phase (recover an interrupted walk, vacuum, drain).
@main
struct NatureExplorerApp: App {
    @State private var container: AppContainer
    @Environment(\.scenePhase) private var scenePhase
    private let kicks: SyncKicks

    init() {
        let container = AppContainer.live()
        _container = State(initialValue: container)
        kicks = SyncKicks(sync: container.walks.sync)
        kicks.start()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(container)
                .onChange(of: scenePhase, initial: true) { _, phase in
                    switch phase {
                    case .active:
                        Task { await container.resumeWalks() }
                    case .background:
                        kicks.scheduleBackgroundRefresh()
                    default:
                        break
                    }
                }
        }
    }
}
