import CH3

/// Namespace for the H3 operations the app needs (FR-004): every function is a pure wrapper over the vendored
/// C core and throws a typed `H3Error` when the library reports a non-zero result code.
public enum H3 {
    /// Version of the vendored H3 C core, e.g. `"4.2.1"` (from the `H3_VERSION_*` macros in h3api.h).
    public static let version = "\(H3_VERSION_MAJOR).\(H3_VERSION_MINOR).\(H3_VERSION_PATCH)"

    /// The lowest and highest H3 resolutions.
    public static let resolutionRange: ClosedRange<Int> = 0...15

    // MARK: Indexing

    /// The cell containing `coordinate` at resolution `res`.
    public static func latLngToCell(_ coordinate: LatLng, res: Int) throws -> H3Index {
        var out: UInt64 = 0
        var input = coordinate.cValue
        try H3Error.check(CH3.latLngToCell(&input, Int32(res), &out))
        return H3Index(value: out)
    }

    /// The centre of `cell`.
    public static func cellToLatLng(_ cell: H3Index) throws -> LatLng {
        try requireValidCell(cell)
        var out = CH3.LatLng(lat: 0, lng: 0)
        try H3Error.check(CH3.cellToLatLng(cell.value, &out))
        return LatLng(c: out)
    }

    /// The vertices of `cell` in counter-clockwise order (6 for hexagons, 5 for pentagons; distorted cells may have more).
    public static func cellToBoundary(_ cell: H3Index) throws -> [LatLng] {
        try requireValidCell(cell)
        var boundary = CellBoundary()
        try H3Error.check(CH3.cellToBoundary(cell.value, &boundary))
        let count = Int(boundary.numVerts)
        return withUnsafePointer(to: &boundary.verts) { tuplePointer in
            tuplePointer.withMemoryRebound(to: CH3.LatLng.self, capacity: Int(MAX_CELL_BNDRY_VERTS)) { pointer in
                (0..<count).map { LatLng(c: pointer[$0]) }
            }
        }
    }

    // MARK: Hierarchy

    /// The parent (or ancestor) of `cell` at the coarser resolution `res`.
    public static func cellToParent(_ cell: H3Index, res: Int) throws -> H3Index {
        try requireValidCell(cell)
        var out: UInt64 = 0
        try H3Error.check(CH3.cellToParent(cell.value, Int32(res), &out))
        return H3Index(value: out)
    }

    /// All children of `cell` at the finer resolution `res`, in the order the C core produces them.
    public static func cellToChildren(_ cell: H3Index, res: Int) throws -> [H3Index] {
        try requireValidCell(cell)
        guard resolutionRange.contains(res), res >= cell.resolution else { throw H3Error.resMismatch }
        var size: Int64 = 0
        try H3Error.check(CH3.cellToChildrenSize(cell.value, Int32(res), &size))
        var buffer = [UInt64](repeating: 0, count: Int(size))
        try buffer.withUnsafeMutableBufferPointer { pointer in
            try H3Error.check(CH3.cellToChildren(cell.value, Int32(res), pointer.baseAddress))
        }
        return buffer.filter { $0 != 0 }.map(H3Index.init(value:))
    }

    // MARK: Traversal

    /// The cells within grid distance `k` of `origin` (including `origin`), unordered.
    public static func gridDisk(_ origin: H3Index, k: Int) throws -> [H3Index] {
        try requireValidCell(origin)
        guard k >= 0 else { throw H3Error.domain }
        var size: Int64 = 0
        try H3Error.check(CH3.maxGridDiskSize(Int32(k), &size))
        var buffer = [UInt64](repeating: 0, count: Int(size))
        try buffer.withUnsafeMutableBufferPointer { pointer in
            try H3Error.check(CH3.gridDisk(origin.value, Int32(k), pointer.baseAddress))
        }
        return buffer.filter { $0 != 0 }.map(H3Index.init(value:))
    }

    /// The line of cells from `start` to `end` (both included), one grid step apart.
    public static func gridPathCells(_ start: H3Index, _ end: H3Index) throws -> [H3Index] {
        try requireValidCell(start)
        try requireValidCell(end)
        var size: Int64 = 0
        try H3Error.check(CH3.gridPathCellsSize(start.value, end.value, &size))
        var buffer = [UInt64](repeating: 0, count: Int(size))
        try buffer.withUnsafeMutableBufferPointer { pointer in
            try H3Error.check(CH3.gridPathCells(start.value, end.value, pointer.baseAddress))
        }
        return buffer.filter { $0 != 0 }.map(H3Index.init(value:))
    }

    /// Whether the two cells share an edge.
    public static func areNeighborCells(_ a: H3Index, _ b: H3Index) throws -> Bool {
        var out: Int32 = 0
        try H3Error.check(CH3.areNeighborCells(a.value, b.value, &out))
        return out != 0
    }

    // MARK: Regions

    /// All cells at resolution `res` whose centre lies inside the polygon described by `outer` (degrees, any winding)
    /// minus the optional `holes`. Mirrors `h3-js` `polygonToCells` with the default containment mode (cell centre).
    public static func polygonToCells(_ outer: [LatLng], holes: [[LatLng]] = [], res: Int) throws -> [H3Index] {
        try withGeoPolygon(outer, holes: holes) { polygon in
            var size: Int64 = 0
            try H3Error.check(CH3.maxPolygonToCellsSize(polygon, Int32(res), 0, &size))
            var buffer = [UInt64](repeating: 0, count: Int(size))
            try buffer.withUnsafeMutableBufferPointer { pointer in
                try H3Error.check(CH3.polygonToCells(polygon, Int32(res), 0, pointer.baseAddress))
            }
            return buffer.filter { $0 != 0 }.map(H3Index.init(value:))
        }
    }

    // MARK: Metrics

    /// Average edge length in metres of cells at resolution `res`.
    public static func hexagonEdgeLengthAverageMeters(res: Int) throws -> Double {
        var out = 0.0
        try H3Error.check(CH3.getHexagonEdgeLengthAvgM(Int32(res), &out))
        return out
    }

    // MARK: - Private helpers

    /// The C core does not validate every input (e.g. `cellToChildrenSize` on garbage would size 7^n children),
    /// so the wrapper checks first and throws `cellInvalid` like the validating C functions do.
    private static func requireValidCell(_ cell: H3Index) throws {
        guard cell.isValidCell else { throw H3Error.cellInvalid }
    }

    /// Builds a `GeoPolygon` (radians) from degree coordinates, keeps every buffer alive for the duration of `body`.
    private static func withGeoPolygon<R>(
        _ outer: [LatLng],
        holes: [[LatLng]],
        _ body: (UnsafePointer<GeoPolygon>) throws -> R
    ) throws -> R {
        let outerBuffer = UnsafeMutablePointer<CH3.LatLng>.allocate(capacity: max(outer.count, 1))
        defer { outerBuffer.deallocate() }
        for (index, point) in outer.enumerated() {
            outerBuffer[index] = point.cValue
        }

        var holeBuffers: [UnsafeMutablePointer<CH3.LatLng>] = []
        defer { holeBuffers.forEach { $0.deallocate() } }
        let holeLoops = UnsafeMutablePointer<GeoLoop>.allocate(capacity: max(holes.count, 1))
        defer { holeLoops.deallocate() }
        for (holeIndex, hole) in holes.enumerated() {
            let buffer = UnsafeMutablePointer<CH3.LatLng>.allocate(capacity: max(hole.count, 1))
            holeBuffers.append(buffer)
            for (index, point) in hole.enumerated() {
                buffer[index] = point.cValue
            }
            holeLoops[holeIndex] = GeoLoop(numVerts: Int32(hole.count), verts: buffer)
        }

        var polygon = GeoPolygon(
            geoloop: GeoLoop(numVerts: Int32(outer.count), verts: outerBuffer),
            numHoles: Int32(holes.count),
            holes: holes.isEmpty ? nil : holeLoops
        )
        return try withUnsafePointer(to: &polygon) { try body($0) }
    }
}
