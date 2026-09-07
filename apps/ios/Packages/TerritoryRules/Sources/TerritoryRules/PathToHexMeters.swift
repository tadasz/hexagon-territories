import Foundation
import H3Kit

/// Splits a (simplified) path into metres per H3 cell — plan.md "Shared Rule Semantics" item 7.
///
/// For each consecutive pair (a, b): if both ends fall in the same cell the whole haversine length is credited to
/// that cell (H3 cells are convex, a straight segment cannot leave and re-enter). Otherwise the exit point from
/// `cell(a)` is located by bisection (linear interpolation in lat/lon) to within `Rules.bisectionToleranceM`, the part
/// before the crossing is credited to `cell(a)` and the remainder is processed the same way, so a segment crossing
/// several cells is split at every boundary. Output is summed per cell, sorted by cell string ascending, and cells
/// with less than `Rules.minHexMetersM` are dropped.
public func pathToHexMeters(_ points: [LatLng], resolution: Int = Rules.res) throws -> [HexMeters] {
    var meters: [H3Index: Double] = [:]
    guard points.count > 1 else { return [] }

    for index in 1..<points.count {
        var start = points[index - 1]
        let end = points[index]
        var startCell = try H3.latLngToCell(start, res: resolution)
        let endCell = try H3.latLngToCell(end, res: resolution)

        // Loop instead of recursion: each iteration credits one cell and moves `start` past its boundary.
        var guardCounter = 0
        while true {
            if startCell == endCell {
                meters[startCell, default: 0] += Geo.distanceMeters(start, end)
                break
            }
            guardCounter += 1
            if guardCounter > 10_000 {
                // Defensive: should be unreachable (a res-9 segment crosses at most a few hundred cells).
                meters[startCell, default: 0] += Geo.distanceMeters(start, end)
                break
            }

            // Bisect on [inside, outside]: `inside` stays in startCell, `outside` is in another cell.
            var inside = start
            var outside = end
            while Geo.distanceMeters(inside, outside) > Rules.bisectionToleranceM {
                let mid = Geo.interpolate(inside, outside, t: 0.5)
                if try H3.latLngToCell(mid, res: resolution) == startCell {
                    inside = mid
                } else {
                    outside = mid
                }
            }
            let outsideCell = try H3.latLngToCell(outside, res: resolution)
            meters[startCell, default: 0] += Geo.distanceMeters(start, outside)
            start = outside
            startCell = outsideCell
        }
    }

    return meters
        .filter { $0.value >= Rules.minHexMetersM }
        .map { HexMeters(cell: $0.key, meters: $0.value) }
        .sorted { $0.cell.description < $1.cell.description }
}

/// Convenience for the client estimate: accepted samples → simplified path → metres per cell.
public func hexMetersForSamples(_ samples: [Sample], resolution: Int = Rules.res) throws -> [HexMeters] {
    let path = simplifyPath(samples.map(\.coordinate))
    return try pathToHexMeters(path, resolution: resolution)
}
