import Core
import Foundation

/// Last known profile so an offline launch still passes the gate (`Me` holds no e-mail or credentials; the tokens
/// live in the Keychain). `userDefaults()` in the app, `inMemory()` in tests and previews.
struct ProfileCache: Sendable {
    let load: @Sendable () -> Me?
    let save: @Sendable (Me) -> Void
    let clear: @Sendable () -> Void

    static func userDefaults(key: String = "profile.me") -> ProfileCache {
        ProfileCache(
            load: {
                guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
                return try? JSONCoding.decoder().decode(Me.self, from: data)
            },
            save: { me in
                if let data = try? JSONCoding.encoder().encode(me) {
                    UserDefaults.standard.set(data, forKey: key)
                }
            },
            clear: { UserDefaults.standard.removeObject(forKey: key) }
        )
    }

    static func inMemory(_ initial: Me? = nil) -> ProfileCache {
        let box = LockedBox(initial)
        return ProfileCache(
            load: { box.value },
            save: { box.value = $0 },
            clear: { box.value = nil }
        )
    }
}

private final class LockedBox: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Me?

    init(_ value: Me?) {
        stored = value
    }

    var value: Me? {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}
