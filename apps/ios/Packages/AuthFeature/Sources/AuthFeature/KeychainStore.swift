import Core
import Foundation
#if canImport(Security)
import Security

/// `TokenStore` over one generic-password Keychain item (research.md R12): the JSON-encoded `TokenPair` under
/// `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — readable after the first unlock so a background refresh
/// works, never synchronised to iCloud, never migrated to another device.
public struct KeychainStore: TokenStore {
    public struct KeychainError: Error, Equatable, Sendable {
        public let operation: String
        public let status: OSStatus
    }

    public let service: String
    public let account: String

    public init(service: String = Bundle.main.bundleIdentifier ?? "com.natureexplorer.app", account: String = "session") {
        self.service = service
        self.account = account
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    public func load() throws -> TokenPair? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        switch status {
        case errSecSuccess:
            guard let data = item as? Data else { return nil }
            return try JSONCoding.decoder().decode(TokenPair.self, from: data)
        case errSecItemNotFound:
            return nil
        default:
            throw KeychainError(operation: "load", status: status)
        }
    }

    public func save(_ pair: TokenPair) throws {
        let data = try JSONCoding.encoder().encode(pair)
        var attributes = baseQuery
        attributes[kSecValueData as String] = data
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(attributes as CFDictionary, nil)
        switch status {
        case errSecSuccess:
            return
        case errSecDuplicateItem:
            let update: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            let updateStatus = SecItemUpdate(baseQuery as CFDictionary, update as CFDictionary)
            guard updateStatus == errSecSuccess else { throw KeychainError(operation: "update", status: updateStatus) }
        default:
            throw KeychainError(operation: "add", status: status)
        }
    }

    public func clear() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError(operation: "delete", status: status)
        }
    }
}
#endif
