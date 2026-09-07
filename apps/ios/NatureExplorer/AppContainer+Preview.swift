import Core
import Foundation

/// A container without network or Keychain for SwiftUI previews (services answer with fixed values).
extension AppContainer {
    static func preview() -> AppContainer {
        let auth = PreviewAuthService()
        return AppContainer(
            session: AuthSession(service: auth, store: InMemoryTokenStore()),
            auth: auth,
            factions: PreviewFactionsService(),
            profile: PreviewProfileService()
        )
    }
}

private let previewMe = Me(
    id: "preview",
    displayName: "Explorer 4821",
    factionId: nil,
    factionChangedAt: nil,
    factionChangeAvailableAt: nil,
    xp: 0,
    level: 1,
    role: .player,
    createdAt: Date(),
    suggestedFactionId: 1
)

private let previewTokens = TokenPair(
    accessToken: "preview",
    accessExpiresAt: Date().addingTimeInterval(900),
    refreshToken: "preview",
    refreshExpiresAt: Date().addingTimeInterval(60 * 86_400)
)

private struct PreviewAuthService: AuthService {
    func signInWithApple(_ payload: AppleSignInPayload) async throws -> AuthResult {
        AuthResult(tokens: previewTokens, me: previewMe, isNewUser: true, restored: false)
    }

    func refresh(refreshToken: String) async throws -> TokenPair { previewTokens }
    func logout(refreshToken: String) async throws {}
}

private func faction(_ id: Int, _ slug: String, _ name: String, _ emoji: String, _ light: String, _ dark: String) -> Faction {
    Faction(id: id, slug: slug, name: name, emoji: emoji, colorLight: light, colorDark: dark, sort: id, stats: .zero)
}

private struct PreviewFactionsService: FactionsService {
    func factions() async throws -> FactionsResponse {
        FactionsResponse(
            factions: [
                faction(1, "owls", "Owls", "🦉", "#4CAF50", "#2E7D32"),
                faction(2, "foxes", "Foxes", "🦊", "#FFC107", "#FFA000"),
                faction(3, "deer", "Deer", "🦌", "#2196F3", "#1976D2"),
            ],
            suggestedFactionId: 1,
            activeWindowDays: 14
        )
    }
}

private struct PreviewProfileService: ProfileService {
    func me() async throws -> Me { previewMe }
    func updateDisplayName(_ displayName: String) async throws -> Me { previewMe }
    func selectFaction(_ factionId: Int) async throws -> Me {
        var me = previewMe
        me.factionId = factionId
        return me
    }

    func deleteAccount() async throws -> AccountDeletion {
        AccountDeletion(deletedAt: Date(), purgeAt: Date().addingTimeInterval(30 * 86_400))
    }

    func export() async throws -> ExportStatus {
        ExportStatus(
            id: "preview", status: .pending, requestedAt: Date(), completedAt: nil, expiresAt: nil, downloadUrl: nil, error: nil
        )
    }
}
