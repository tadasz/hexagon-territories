import Core
import Foundation
import OpenAPIRuntime

/// Dates the way the API writes them (`2026-09-07T10:00:04.000Z`) and also without fractional seconds, via
/// `Core.JSONCoding`, so the generated client and the Keychain JSON agree on one format.
struct LenientISO8601DateTranscoder: DateTranscoder {
    func encode(_ date: Date) throws -> String {
        JSONCoding.formatISO8601(date)
    }

    func decode(_ dateString: String) throws -> Date {
        guard let date = JSONCoding.parseISO8601(dateString) else {
            throw DecodingError.dataCorrupted(.init(
                codingPath: [],
                debugDescription: "Expected an ISO 8601 date-time, got \"\(dateString)\""
            ))
        }
        return date
    }
}
