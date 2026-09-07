import Foundation

/// Map zoom → H3 resolution, the prototype's `zoomToResolution` table (plan.md "Shared Rule Semantics" item 3):
/// z ≥ 16 → 9, 14–15 → 8, 12–13 → 7, 10–11 → 6, 8–9 → 5, 6–7 → 4, 4–5 → 3, 2–3 → 2, 0–1 → 1.
/// Non-integer zooms are floored; z < 0 → 1; z > 18 → 9. Fixture: `zoom-resolution.json`.
public func resolutionForZoom(_ zoom: Double) -> Int {
    guard zoom.isFinite else { return zoom > 0 ? 9 : 1 }
    let z = Int(zoom.rounded(.down))
    switch z {
    case ..<2: return 1
    case 2...3: return 2
    case 4...5: return 3
    case 6...7: return 4
    case 8...9: return 5
    case 10...11: return 6
    case 12...13: return 7
    case 14...15: return 8
    default: return 9
    }
}
