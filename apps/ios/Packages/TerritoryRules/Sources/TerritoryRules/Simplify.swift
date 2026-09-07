import Foundation
import H3Kit

/// Douglas–Peucker simplification (plan.md item 6): perpendicular tolerance in metres measured in a local
/// equirectangular projection centred on the path; endpoints are always kept.
public func simplifyPath(_ points: [LatLng], toleranceM: Double = Rules.simplifyToleranceM) -> [LatLng] {
    guard points.count > 2 else { return points }

    let meanLat = points.reduce(0.0) { $0 + $1.lat } / Double(points.count)
    let meanLon = points.reduce(0.0) { $0 + $1.lon } / Double(points.count)
    let cosLat = cos(meanLat * .pi / 180)
    let projected: [(x: Double, y: Double)] = points.map { point in
        (
            x: (point.lon - meanLon) * .pi / 180 * cosLat * Rules.earthRadiusM,
            y: (point.lat - meanLat) * .pi / 180 * Rules.earthRadiusM
        )
    }

    var keep = [Bool](repeating: false, count: points.count)
    keep[0] = true
    keep[points.count - 1] = true

    // Iterative Douglas–Peucker with an explicit stack (no recursion depth issues on long walks).
    var stack: [(first: Int, last: Int)] = [(0, points.count - 1)]
    while let range = stack.popLast() {
        guard range.last - range.first > 1 else { continue }
        var maxDistance = -1.0
        var maxIndex = range.first
        for index in (range.first + 1)..<range.last {
            let distance = perpendicularDistance(projected[index], from: projected[range.first], to: projected[range.last])
            if distance > maxDistance {
                maxDistance = distance
                maxIndex = index
            }
        }
        if maxDistance > toleranceM {
            keep[maxIndex] = true
            stack.append((range.first, maxIndex))
            stack.append((maxIndex, range.last))
        }
    }

    return zip(points, keep).compactMap { $1 ? $0 : nil }
}

private func perpendicularDistance(
    _ point: (x: Double, y: Double),
    from start: (x: Double, y: Double),
    to end: (x: Double, y: Double)
) -> Double {
    let dx = end.x - start.x
    let dy = end.y - start.y
    let lengthSquared = dx * dx + dy * dy
    if lengthSquared == 0 {
        return hypot(point.x - start.x, point.y - start.y)
    }
    // Distance to the infinite line through start/end, clamped to the segment.
    var t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared
    t = min(1, max(0, t))
    let projX = start.x + t * dx
    let projY = start.y + t * dy
    return hypot(point.x - projX, point.y - projY)
}
