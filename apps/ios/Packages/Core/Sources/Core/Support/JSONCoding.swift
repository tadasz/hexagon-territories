import Foundation

/// JSON coders matching the API's conventions: ISO 8601 UTC timestamps with fractional seconds
/// (`2026-09-07T10:00:04.000Z`, as Node's `toISOString()` writes them) and, when decoding, also without
/// (`2026-09-07T10:00:04Z`, as the contract examples are written). Fresh instances are returned because
/// `JSONDecoder` / `JSONEncoder` are not `Sendable`.
public enum JSONCoding {
    public static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let raw = try container.decode(String.self)
            guard let date = parseISO8601(raw) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Expected an ISO 8601 date-time, got \"\(raw)\""
                )
            }
            return date
        }
        return decoder
    }

    public static func encoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatISO8601(date))
        }
        return encoder
    }

    /// Parses `YYYY-MM-DDTHH:MM:SS(.fff)Z` (or with a numeric offset). `nil` for anything else.
    public static func parseISO8601(_ string: String) -> Date? {
        if let date = try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(string) {
            return date
        }
        return try? Date.ISO8601FormatStyle().parse(string)
    }

    /// Formats as `YYYY-MM-DDTHH:MM:SS.fffZ`.
    public static func formatISO8601(_ date: Date) -> String {
        date.formatted(Date.ISO8601FormatStyle(includingFractionalSeconds: true))
    }
}
