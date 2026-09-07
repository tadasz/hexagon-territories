import SwiftUI

/// App entry point. The container is created once and injected into the environment; views read services from it
/// (`docs/architecture.md` §4: SwiftUI views → `@Observable` view models → protocol-typed services from `AppContainer`).
@main
struct NatureExplorerApp: App {
    @State private var container = AppContainer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(container)
        }
    }
}
