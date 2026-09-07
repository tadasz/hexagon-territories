import Foundation

#if canImport(CoreMotion)
import CoreMotion

/// `PedometerSource` over `CMPedometer.queryPedometerData(from:to:)` (research.md R16). Answers `nil` when step
/// counting is unavailable (simulator) or motion access was denied, so the server never evaluates `no_steps` for
/// such walks (spec edge case "pedometer unavailable").
public final class PedometerBridge: PedometerSource, @unchecked Sendable {
    private let pedometer = CMPedometer()

    public init() {}

    public static var isAvailable: Bool {
        CMPedometer.isStepCountingAvailable() && CMPedometer.authorizationStatus() != .denied
            && CMPedometer.authorizationStatus() != .restricted
    }

    public func steps(from start: Date, to end: Date) async -> Int? {
        guard Self.isAvailable, end > start else { return nil }
        return await withCheckedContinuation { continuation in
            pedometer.queryPedometerData(from: start, to: end) { data, error in
                guard error == nil, let steps = data?.numberOfSteps else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: steps.intValue)
            }
        }
    }
}
#endif
