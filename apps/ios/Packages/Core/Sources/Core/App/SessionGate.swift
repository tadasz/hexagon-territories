import Foundation

/// What `RootView` shows (research.md R12): the sign-in screen when signed out, the faction pick until the
/// profile has a faction, otherwise the tab bar. `.loading` covers launch (restore) and the first profile load.
public enum SessionGate: Equatable, Sendable {
    case loading
    case signIn
    case factionPick
    case tabs

    public static func decide(session: AuthState, me: Me?, isRestoring: Bool) -> SessionGate {
        if isRestoring { return .loading }
        guard session.isSignedIn else { return .signIn }
        guard let me else { return .loading }
        return me.hasFaction ? .tabs : .factionPick
    }
}
