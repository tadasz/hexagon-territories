import Foundation

/// Why a display name was rejected. `rule` matches the API's `details.rule` (`contracts/openapi.yaml` PATCH /v1/me).
public enum DisplayNameError: Error, Equatable, Sendable {
    case tooShort
    case tooLong
    case controlCharacter

    public var rule: String {
        switch self {
        case .tooShort: "tooShort"
        case .tooLong: "tooLong"
        case .controlCharacter: "controlCharacter"
        }
    }

    /// Inline form message.
    public var message: String {
        switch self {
        case .tooShort: "Use at least \(DisplayNameValidator.minScalars) characters."
        case .tooLong: "Use at most \(DisplayNameValidator.maxScalars) characters."
        case .controlCharacter: "Line breaks and control characters are not allowed."
        }
    }
}

/// The display-name rule shared with `apps/api/src/modules/me/display-name.ts` (data-model.md §2.7, plan.md Shared
/// Semantics 7): trim Unicode `White_Space`, reject any control character (general category `Cc`), then require
/// 2–24 Unicode scalars. Both implementations run the same test vector.
public enum DisplayNameValidator {
    public static let minScalars = 2
    public static let maxScalars = 24

    public static func validate(_ raw: String) -> Result<String, DisplayNameError> {
        let trimmed = trim(raw)
        if trimmed.unicodeScalars.contains(where: { $0.properties.generalCategory == .control }) {
            return .failure(.controlCharacter)
        }
        let count = scalarCount(trimmed)
        if count < minScalars { return .failure(.tooShort) }
        if count > maxScalars { return .failure(.tooLong) }
        return .success(trimmed)
    }

    /// Strips leading and trailing Unicode `White_Space` scalars.
    public static func trim(_ raw: String) -> String {
        let scalars = raw.unicodeScalars
        guard let first = scalars.firstIndex(where: { !$0.properties.isWhitespace }) else { return "" }
        var last = scalars.index(before: scalars.endIndex)
        while last > first, scalars[last].properties.isWhitespace {
            last = scalars.index(before: last)
        }
        return String(String.UnicodeScalarView(scalars[first...last]))
    }

    /// Length as the rule counts it: Unicode scalars (an emoji is one).
    public static func scalarCount(_ value: String) -> Int {
        value.unicodeScalars.count
    }
}
