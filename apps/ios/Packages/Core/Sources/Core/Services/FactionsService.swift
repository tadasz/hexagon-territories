import Foundation

/// `GET /v1/factions` — no session required.
public protocol FactionsService: Sendable {
    func factions() async throws -> FactionsResponse
}
