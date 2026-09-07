import Core
import Foundation

public extension DeviceInfo {
    /// `deviceInfo` for `POST /v1/walks`: hardware model (`utsname.machine`), OS version, app version (no identifiers).
    static func current(bundle: Bundle = .main) -> DeviceInfo {
        var system = utsname()
        uname(&system)
        let machine = withUnsafeBytes(of: &system.machine) { raw -> String in
            let bytes = raw.prefix { $0 != 0 }
            return String(decoding: bytes, as: UTF8.self)
        }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        return DeviceInfo(
            model: machine.isEmpty ? nil : machine,
            osVersion: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)",
            appVersion: bundle.infoDictionary?["CFBundleShortVersionString"] as? String
        )
    }
}
