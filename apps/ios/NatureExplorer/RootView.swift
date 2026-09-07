import AuthFeature
import Core
import DesignSystem
import FactionsFeature
import MapFeature
import ProfileFeature
import SwiftUI

/// Gate + six-tab shell (research.md R12; `docs/architecture.md` §4): signed out → `SignInView`; signed in without
/// a faction → `FactionPickView`; otherwise Map · Walk · Capture · Collection · Factions · Profile.
struct RootView: View {
    @Environment(AppContainer.self) private var container
    @State private var selectedTab: AppTab = .map

    var body: some View {
        Group {
            switch container.gate {
            case .loading:
                LoadingRoute(container: container)
            case .signIn:
                SignInRoute(container: container)
            case .factionPick:
                FactionPickRoute(container: container)
            case .tabs:
                tabs
            }
        }
        .task { await container.start() }
    }

    private var tabs: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                screen(for: tab)
                    .tabItem { Label(tab.title, systemImage: tab.systemImage) }
                    .tag(tab)
            }
        }
        .accessibilityIdentifier("root.tabs")
    }

    @ViewBuilder
    private func screen(for tab: AppTab) -> some View {
        switch tab {
        case .map:
            MapScreen(config: container.mapConfig)
        case .factions:
            FactionsTabRoute(container: container)
        case .profile:
            ProfileTabRoute(container: container)
        case .walk, .capture, .collection:
            PlaceholderScreen(title: tab.title, systemImage: tab.systemImage)
        }
    }
}

/// Launch / first profile load; offers a retry (and a way out) when the profile cannot be fetched.
private struct LoadingRoute: View {
    let container: AppContainer

    var body: some View {
        if let message = container.profileError {
            ContentUnavailableView {
                Label("Could not load your profile", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try again") { Task { await container.loadProfile() } }
                    .buttonStyle(.borderedProminent)
                Button("Sign out") { Task { await container.session.signOut() } }
            }
            .accessibilityIdentifier("root.profileError")
        } else {
            ProgressView()
                .accessibilityIdentifier("root.loading")
        }
    }
}

/// Each route owns its view model as `@State` so it survives re-renders of `RootView`.
private struct SignInRoute: View {
    @State private var viewModel: AuthViewModel

    init(container: AppContainer) {
        _viewModel = State(initialValue: AuthViewModel(session: container.session) { container.signedIn($0) })
    }

    var body: some View {
        SignInView(viewModel: viewModel)
    }
}

private struct FactionPickRoute: View {
    @State private var viewModel: FactionsViewModel

    init(container: AppContainer) {
        _viewModel = State(initialValue: FactionsViewModel(
            factions: container.factionsService,
            profile: container.profileService,
            me: container.me
        ) { container.update(me: $0) })
    }

    var body: some View {
        FactionPickView(viewModel: viewModel)
    }
}

private struct FactionsTabRoute: View {
    @State private var viewModel: FactionsViewModel

    init(container: AppContainer) {
        _viewModel = State(initialValue: FactionsViewModel(
            factions: container.factionsService,
            profile: container.profileService,
            me: container.me
        ) { container.update(me: $0) })
    }

    var body: some View {
        FactionsScreen(viewModel: viewModel)
    }
}

private struct ProfileTabRoute: View {
    @State private var viewModel: ProfileViewModel

    init(container: AppContainer) {
        _viewModel = State(initialValue: ProfileViewModel(
            profile: container.profileService,
            factions: container.factionsService,
            session: container.session,
            me: container.me
        ) { container.update(me: $0) })
    }

    var body: some View {
        ProfileScreen(viewModel: viewModel)
    }
}

#Preview {
    RootView()
        .environment(AppContainer.preview())
}
