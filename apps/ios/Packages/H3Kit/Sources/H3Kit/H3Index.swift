import CH3

/// A 64-bit H3 index (cell, directed edge or vertex). Cells are compared and hashed by their raw value,
/// and printed as the canonical lowercase hex string used by the fixtures and the API (15 characters for a cell).
public struct H3Index: Hashable, Comparable, Sendable {
    /// The raw 64-bit index as used by the H3 C library and stored as `bigint` by the API.
    public let value: UInt64

    public init(value: UInt64) {
        self.value = value
    }

    /// Parses the hexadecimal representation used by `h3-js` and the fixtures (e.g. `"891f1d4a2c3ffff"`).
    /// Returns `nil` for anything the H3 core rejects (`stringToH3` failing) or for an empty string.
    public init?(string: String) {
        guard !string.isEmpty else { return nil }
        var raw: UInt64 = 0
        let code = string.withCString { cString in
            stringToH3(cString, &raw)
        }
        guard code == 0, raw != 0 else { return nil }
        self.value = raw
    }

    /// Whether this index is a valid H3 cell (as opposed to an edge, vertex or garbage).
    public var isValidCell: Bool {
        CH3.isValidCell(value) != 0
    }

    /// The resolution (0...15) encoded in the index.
    public var resolution: Int {
        Int(CH3.getResolution(value))
    }

    /// Whether the cell is one of the twelve pentagons of its resolution.
    public var isPentagon: Bool {
        CH3.isPentagon(value) != 0
    }

    public static func < (lhs: H3Index, rhs: H3Index) -> Bool {
        lhs.value < rhs.value
    }
}

extension H3Index: CustomStringConvertible {
    /// Canonical lowercase hexadecimal string without leading zeros (15 characters for any valid cell).
    public var description: String {
        String(value, radix: 16, uppercase: false)
    }
}

extension H3Index: LosslessStringConvertible {
    public init?(_ description: String) {
        self.init(string: description)
    }
}

extension H3Index: Codable {
    /// Encoded as the hex string (fixtures and API JSON use strings, never numbers).
    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        guard let index = H3Index(string: string) else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "not an H3 index: \"\(string)\""
            )
        }
        self = index
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(description)
    }
}
