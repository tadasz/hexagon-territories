import Core
import Foundation
import OpenAPIRuntime

/// Generated types → `Core` models. Kept in one place so a regenerated client breaks exactly one file.
extension Components.Schemas.Me {
    var core: Me {
        Me(
            id: id,
            displayName: displayName,
            factionId: factionId,
            factionChangedAt: factionChangedAt,
            factionChangeAvailableAt: factionChangeAvailableAt,
            xp: xp,
            level: level,
            role: Me.Role(rawValue: role.rawValue) ?? .player,
            createdAt: createdAt,
            suggestedFactionId: suggestedFactionId
        )
    }
}

extension Components.Schemas.TokenPair {
    var core: TokenPair {
        TokenPair(
            accessToken: accessToken,
            accessExpiresAt: accessExpiresAt,
            refreshToken: refreshToken,
            refreshExpiresAt: refreshExpiresAt
        )
    }
}

extension Components.Schemas.AuthResponse {
    var core: AuthResult {
        AuthResult(tokens: tokens.core, me: me.core, isNewUser: isNewUser, restored: restored)
    }
}

extension Components.Schemas.FactionStats {
    var core: FactionStats {
        FactionStats(members: members, activeMembers: activeMembers, hexesOwnedR9: hexesOwnedR9, hexesOwnedR7: hexesOwnedR7)
    }
}

extension Components.Schemas.Faction {
    var core: Faction {
        Faction(
            id: id,
            slug: slug,
            name: name,
            emoji: emoji,
            colorLight: colorLight,
            colorDark: colorDark,
            sort: sort,
            stats: stats.core
        )
    }
}

extension Components.Schemas.FactionsResponse {
    var core: FactionsResponse {
        FactionsResponse(
            factions: factions.map(\.core),
            suggestedFactionId: suggestedFactionId,
            activeWindowDays: activeWindowDays
        )
    }
}

extension Components.Schemas.AccountDeletion {
    var core: AccountDeletion {
        AccountDeletion(deletedAt: deletedAt, purgeAt: purgeAt)
    }
}

extension Components.Schemas.ExportStatus {
    var core: ExportStatus {
        ExportStatus(
            id: id,
            status: ExportState(rawValue: status.rawValue) ?? .failed,
            requestedAt: requestedAt,
            completedAt: completedAt,
            expiresAt: expiresAt,
            downloadUrl: downloadUrl,
            error: error
        )
    }
}

extension Components.Schemas.AuthAppleRequest {
    init(_ payload: AppleSignInPayload) {
        self.init(
            identityToken: payload.identityToken,
            authorizationCode: payload.authorizationCode,
            fullName: payload.fullName.map { .init(givenName: $0.givenName, familyName: $0.familyName) }
        )
    }
}

/// Runs one generated operation and normalises failures: the `APIError` thrown by the middlewares is unwrapped
/// from the runtime's `ClientError`; decoding problems become `.unexpected`; everything else is `.network`.
func performRequest<T: Sendable>(_ operation: () async throws -> T) async throws -> T {
    do {
        return try await operation()
    } catch let error as APIError {
        throw error
    } catch let error as ClientError {
        if let apiError = error.underlyingError as? APIError {
            throw apiError
        }
        if error.underlyingError is DecodingError {
            throw APIError.unexpected(code: "DECODING", status: error.response?.status.code ?? 0)
        }
        throw APIError.network(underlying: error.underlyingError)
    } catch is DecodingError {
        throw APIError.unexpected(code: "DECODING", status: 0)
    } catch {
        throw APIError.network(underlying: error)
    }
}

/// A documented non-2xx case reaching an adapter means the envelope middleware was bypassed; report it plainly.
func unexpectedResponse(status: Int) -> APIError {
    .unexpected(code: status == 0 ? "UNEXPECTED_RESPONSE" : "HTTP_\(status)", status: status)
}
