import TerritoryRules
import XCTest

/// Every constant equals the literal value in `docs/territory-rules.md` "Constants summary" (and the
/// walk-acceptance table / data-model.md §2). The numbers are hard-coded on purpose: if the doc changes, this
/// test must change with it, in the order fixtures → TypeScript → Swift → docs.
final class RulesConstantsTests: XCTestCase {
    func testConstantsSummary() {
        XCTAssertEqual(Rules.res, 9, "RES = 9")
        XCTAssertEqual(Rules.simplifyToleranceM, 5, "SIMPLIFY_TOLERANCE_M = 5")
        XCTAssertEqual(Rules.weeklyCapMPerPlayerPerCell, 2000, "WEEKLY_CAP_M_PER_PLAYER_PER_CELL = 2000")
        XCTAssertEqual(Rules.bonusBirdM, 300, "BONUS_BIRD_M = 300")
        XCTAssertEqual(Rules.bonusPlantM, 200, "BONUS_PLANT_M = 200")
        XCTAssertEqual(Rules.bonusCapPerPlayerPerCellPerWeek, 5, "BONUS_CAP_PER_PLAYER_PER_CELL_PER_WEEK = 5")
        XCTAssertEqual(Rules.decay, 0.5, "DECAY = 0.5")
        XCTAssertEqual(Rules.minStrengthM, 500, "MIN_STRENGTH_M = 500")
        XCTAssertEqual(Rules.hysteresis, 0.10, "HYSTERESIS = 0.10")
        XCTAssertEqual(Rules.parentPlurality, 0.40, "PARENT_PLURALITY = 0.40")
        XCTAssertEqual(Rules.parentMinClaimedChildren, 2, "PARENT_MIN_CLAIMED_CHILDREN = 2")
        XCTAssertEqual(Rules.reckoningCron, "0 0 * * 1", "RECKONING_CRON")
        XCTAssertEqual(Rules.tz, "UTC", "TZ")
    }

    func testWalkAcceptanceThresholds() {
        XCTAssertEqual(Rules.maxSampleHAccM, 50, "horizontalAccuracy > 50 m drops the sample")
        XCTAssertEqual(Rules.maxSampleSpeedMps, 5, "speed > 5 m/s drops the sample")
        XCTAssertEqual(Rules.teleportSpeedMps, 8, "implied speed > 8 m/s flags teleport")
        XCTAssertEqual(Rules.maxWalkMedianSpeedMps, 3.5, "median speed > 3.5 m/s flags speed")
        XCTAssertEqual(Rules.maxWalkDistanceM, 30000, "> 30 km flags distance")
        XCTAssertEqual(Rules.maxWalkDurationS, 21600, "> 6 h flags distance")
        XCTAssertEqual(Rules.minStepsPerM, 0.5, "steps / distance < 0.5 flags no_steps")
        XCTAssertEqual(Rules.noStepsMinDistanceM, 500, "no_steps applies over 500 m")
    }

    func testSharedNumericalConventions() {
        XCTAssertEqual(Rules.earthRadiusM, 6_371_008.8, "plan.md item 2")
        XCTAssertEqual(Rules.bisectionToleranceM, 0.05, "plan.md item 7")
        XCTAssertEqual(Rules.minHexMetersM, 0.01, "plan.md item 7")
        XCTAssertEqual(Rules.minRetainedStrengthM, 0.001, "plan.md item 9")
    }
}
