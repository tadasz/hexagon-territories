import Core
import Foundation

/// A transport failure that is not an `APIError` (what `URLSession` would throw offline).
public struct OfflineError: Error, Equatable, Sendable {
    public init() {}
}

/// Sample values matching the examples in `contracts/openapi.yaml`.
public enum Fixtures {
    /// 2026-09-07T10:00:00Z — the contract's example day.
    public static let now = Date(timeIntervalSince1970: 1_788_775_200)

    public static var offline: APIError { .network(underlying: OfflineError()) }

    public static func tokenPair(
        access: String = "access-1",
        refresh: String = "refresh-1",
        accessExpiresIn: TimeInterval = 900,
        refreshExpiresIn: TimeInterval = 60 * 86_400,
        from now: Date = Fixtures.now
    ) -> TokenPair {
        TokenPair(
            accessToken: access,
            accessExpiresAt: now.addingTimeInterval(accessExpiresIn),
            refreshToken: refresh,
            refreshExpiresAt: now.addingTimeInterval(refreshExpiresIn)
        )
    }

    public static func me(
        id: String = "9c1f2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
        displayName: String = "Explorer 4821",
        factionId: Int? = 1,
        factionChangedAt: Date? = nil,
        factionChangeAvailableAt: Date? = nil,
        xp: Int = 0,
        level: Int = 1,
        suggestedFactionId: Int = 3
    ) -> Me {
        Me(
            id: id,
            displayName: displayName,
            factionId: factionId,
            factionChangedAt: factionChangedAt,
            factionChangeAvailableAt: factionChangeAvailableAt,
            xp: xp,
            level: level,
            role: .player,
            createdAt: now.addingTimeInterval(-7 * 86_400),
            suggestedFactionId: suggestedFactionId
        )
    }

    public static func authResult(
        me: Me = Fixtures.me(factionId: nil),
        tokens: TokenPair = Fixtures.tokenPair(),
        isNewUser: Bool = true,
        restored: Bool = false
    ) -> AuthResult {
        AuthResult(tokens: tokens, me: me, isNewUser: isNewUser, restored: restored)
    }

    public static let applePayload = AppleSignInPayload(
        identityToken: "apple-identity-jwt",
        authorizationCode: "apple-code",
        fullName: PersonName(givenName: "Tadas", familyName: nil)
    )

    public static func faction(
        id: Int,
        slug: String,
        name: String,
        emoji: String,
        colorLight: String,
        colorDark: String,
        sort: Int,
        stats: FactionStats
    ) -> Faction {
        Faction(
            id: id, slug: slug, name: name, emoji: emoji, colorLight: colorLight, colorDark: colorDark, sort: sort,
            stats: stats
        )
    }

    /// The contract's `GET /v1/factions` example: Owls 12/9, Foxes 10/10, Deer 4/3, suggestion 3.
    public static func factionsResponse(
        stats: [FactionStats] = [
            FactionStats(members: 12, activeMembers: 9, hexesOwnedR9: 0, hexesOwnedR7: 0),
            FactionStats(members: 10, activeMembers: 10, hexesOwnedR9: 0, hexesOwnedR7: 0),
            FactionStats(members: 4, activeMembers: 3, hexesOwnedR9: 0, hexesOwnedR7: 0),
        ],
        suggestedFactionId: Int = 3,
        activeWindowDays: Int = 14
    ) -> FactionsResponse {
        FactionsResponse(
            factions: [
                faction(
                    id: 1, slug: "owls", name: "Owls", emoji: "🦉", colorLight: "#4CAF50", colorDark: "#2E7D32", sort: 1,
                    stats: stats[0]
                ),
                faction(
                    id: 2, slug: "foxes", name: "Foxes", emoji: "🦊", colorLight: "#FFC107", colorDark: "#FFA000", sort: 2,
                    stats: stats[1]
                ),
                faction(
                    id: 3, slug: "deer", name: "Deer", emoji: "🦌", colorLight: "#2196F3", colorDark: "#1976D2", sort: 3,
                    stats: stats[2]
                ),
            ],
            suggestedFactionId: suggestedFactionId,
            activeWindowDays: activeWindowDays
        )
    }

    public static func accountDeletion(deletedAt: Date = Fixtures.now) -> AccountDeletion {
        AccountDeletion(deletedAt: deletedAt, purgeAt: deletedAt.addingTimeInterval(30 * 86_400))
    }

    public static func exportStatus(
        _ state: ExportState,
        downloadUrl: String? = nil,
        error: String? = nil,
        requestedAt: Date = Fixtures.now
    ) -> ExportStatus {
        ExportStatus(
            id: "1b6f2d3c-4a5b-4c6d-8e9f-0a1b2c3d4e5f",
            status: state,
            requestedAt: requestedAt,
            completedAt: state == .pending ? nil : requestedAt.addingTimeInterval(4),
            expiresAt: state == .ready ? requestedAt.addingTimeInterval(7 * 86_400) : nil,
            downloadUrl: downloadUrl ?? (state == .ready ? "http://localhost:9000/nature-media/exports/x.json?sig=1" : nil),
            error: error
        )
    }
}
