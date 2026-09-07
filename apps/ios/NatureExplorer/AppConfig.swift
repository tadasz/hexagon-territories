import Foundation

/// Build-time configuration read from the bundle's Info.plist (plan.md "Info.plist keys").
enum AppConfig {
    /// `API_BASE_URL`; `http://localhost:3000` (the `make dev` API) when missing or malformed.
    static let defaultAPIBaseURL = URL(string: "http://localhost:3000")!

    static func apiBaseURL(bundle: Bundle = .main) -> URL {
        guard let raw = bundle.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme != nil, url.host != nil
        else { return defaultAPIBaseURL }
        return url
    }
}
