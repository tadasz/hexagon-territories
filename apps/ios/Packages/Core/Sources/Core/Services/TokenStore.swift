import Foundation

/// Persistence for the token pair: the Keychain in the app (`AuthFeature.KeychainStore`), memory in tests and
/// previews (`InMemoryTokenStore`). Synchronous because Keychain calls are; called only from `AuthSession`.
public protocol TokenStore: Sendable {
    func load() throws -> TokenPair?
    func save(_ pair: TokenPair) throws
    func clear() throws
}
