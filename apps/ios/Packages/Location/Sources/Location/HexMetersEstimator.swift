import Foundation
import H3Kit
import TerritoryRules

/// Live per-hex estimate (`docs/architecture.md` §4 step 3, research.md R16/R19): every accepted point extends the
/// raw path by one segment, which `pathToHexMeters` splits at res-9 boundaries; metres are summed per cell.
/// The estimate runs over the *raw* accepted path (the server simplifies first), so it is provisional by design and
/// the HUD says so. Incremental sums equal one batch `pathToHexMeters(rawAccepted)` call within rounding.
public struct HexMetersEstimator: Sendable, Equatable {
    public let resolution: Int
    public private(set) var metersByCell: [H3Index: Double] = [:]
    /// Every cell the path entered (including ones with < 1 cm credited): the HUD's "hexagons visited".
    public private(set) var touched: Set<H3Index> = []
    public private(set) var currentCell: H3Index?
    public private(set) var distanceM = 0.0
    public private(set) var points: [LatLng] = []

    public init(resolution: Int = Rules.res) {
        self.resolution = resolution
    }

    public var hexCount: Int { touched.count }

    public var currentCellMeters: Double {
        currentCell.flatMap { metersByCell[$0] } ?? 0
    }

    /// Extends the path by one accepted point.
    public mutating func add(_ point: LatLng) throws {
        let cell = try H3.latLngToCell(point, res: resolution)
        if let previous = points.last {
            for credit in try pathToHexMeters([previous, point], resolution: resolution) {
                metersByCell[credit.cell, default: 0] += credit.meters
                touched.insert(credit.cell)
            }
            distanceM += Geo.distanceMeters(previous, point)
        }
        touched.insert(cell)
        currentCell = cell
        points.append(point)
    }

    /// Per-cell metres sorted by cell string ascending, cells under `Rules.minHexMetersM` dropped — the same shape
    /// `pathToHexMeters` returns.
    public func snapshot() -> [HexMeters] {
        metersByCell
            .filter { $0.value >= Rules.minHexMetersM }
            .map { HexMeters(cell: $0.key, meters: $0.value) }
            .sorted { $0.cell.description < $1.cell.description }
    }

    public mutating func reset() {
        metersByCell = [:]
        touched = []
        currentCell = nil
        distanceM = 0
        points = []
    }

    /// Rebuilds the estimator from stored accepted points (recovery).
    public mutating func restore(points stored: [LatLng]) throws {
        reset()
        for point in stored {
            try add(point)
        }
    }
}
