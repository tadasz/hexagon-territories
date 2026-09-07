import CH3

/// Typed mirror of the H3 C library's `H3Error` result codes (h3api.h `H3ErrorCodes`).
/// Every wrapper in `H3` throws one of these when the C call returns a non-zero code.
public enum H3Error: Error, Equatable, Hashable, Sendable {
    /// `E_FAILED` — the operation failed but a more specific error is not available.
    case failed
    /// `E_DOMAIN` — an argument was outside its acceptable range.
    case domain
    /// `E_LATLNG_DOMAIN` — latitude/longitude outside the acceptable range.
    case latLngDomain
    /// `E_RES_DOMAIN` — resolution outside 0...15.
    case resDomain
    /// `E_CELL_INVALID` — the cell index is not valid.
    case cellInvalid
    /// `E_DIR_EDGE_INVALID`
    case directedEdgeInvalid
    /// `E_UNDIR_EDGE_INVALID`
    case undirectedEdgeInvalid
    /// `E_VERTEX_INVALID`
    case vertexInvalid
    /// `E_PENTAGON` — pentagon distortion was encountered and the algorithm could not handle it.
    case pentagon
    /// `E_DUPLICATE_INPUT`
    case duplicateInput
    /// `E_NOT_NEIGHBORS`
    case notNeighbors
    /// `E_RES_MISMATCH`
    case resMismatch
    /// `E_MEMORY_ALLOC`
    case memoryAlloc
    /// `E_MEMORY_BOUNDS` — the provided output buffer was too small.
    case memoryBounds
    /// `E_OPTION_INVALID`
    case optionInvalid
    /// A code this wrapper does not know (newer H3 release than the vendored one).
    case unknown(code: UInt32)
    /// Raised by the Swift layer itself, e.g. an unparsable cell string.
    case invalidCellString(String)

    /// Maps a raw C result code to a Swift error. `0` (`E_SUCCESS`) has no error and returns `nil`.
    public init?(code: UInt32) {
        switch code {
        case 0: return nil
        case 1: self = .failed
        case 2: self = .domain
        case 3: self = .latLngDomain
        case 4: self = .resDomain
        case 5: self = .cellInvalid
        case 6: self = .directedEdgeInvalid
        case 7: self = .undirectedEdgeInvalid
        case 8: self = .vertexInvalid
        case 9: self = .pentagon
        case 10: self = .duplicateInput
        case 11: self = .notNeighbors
        case 12: self = .resMismatch
        case 13: self = .memoryAlloc
        case 14: self = .memoryBounds
        case 15: self = .optionInvalid
        default: self = .unknown(code: code)
        }
    }

    /// Throws the matching `H3Error` when `code` is not `E_SUCCESS`.
    @inlinable
    static func check(_ code: UInt32) throws {
        if let error = H3Error(code: code) {
            throw error
        }
    }
}

extension H3Error: CustomStringConvertible {
    public var description: String {
        switch self {
        case .failed: "H3 E_FAILED"
        case .domain: "H3 E_DOMAIN"
        case .latLngDomain: "H3 E_LATLNG_DOMAIN"
        case .resDomain: "H3 E_RES_DOMAIN"
        case .cellInvalid: "H3 E_CELL_INVALID"
        case .directedEdgeInvalid: "H3 E_DIR_EDGE_INVALID"
        case .undirectedEdgeInvalid: "H3 E_UNDIR_EDGE_INVALID"
        case .vertexInvalid: "H3 E_VERTEX_INVALID"
        case .pentagon: "H3 E_PENTAGON"
        case .duplicateInput: "H3 E_DUPLICATE_INPUT"
        case .notNeighbors: "H3 E_NOT_NEIGHBORS"
        case .resMismatch: "H3 E_RES_MISMATCH"
        case .memoryAlloc: "H3 E_MEMORY_ALLOC"
        case .memoryBounds: "H3 E_MEMORY_BOUNDS"
        case .optionInvalid: "H3 E_OPTION_INVALID"
        case let .unknown(code): "H3 error code \(code)"
        case let .invalidCellString(string): "invalid H3 cell string \"\(string)\""
        }
    }
}
