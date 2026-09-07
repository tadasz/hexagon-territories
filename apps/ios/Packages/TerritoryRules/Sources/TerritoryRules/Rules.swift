/// Game constants — the Swift mirror of `packages/territory-rules/src/config.ts` (`RULES`), whose values come from
/// `docs/territory-rules.md` "Constants summary" plus the walk-acceptance thresholds of data-model.md §2.
/// Change order for any value: fixtures → TypeScript → Swift → docs (Constitution II). Never edit here first.
public enum Rules {
    // MARK: docs/territory-rules.md "Constants summary"

    /// `RES` — all scoring happens at H3 resolution 9.
    public static let res = 9
    /// `SIMPLIFY_TOLERANCE_M` — Douglas–Peucker tolerance applied before hex splitting.
    public static let simplifyToleranceM = 5.0
    /// `WEEKLY_CAP_M_PER_PLAYER_PER_CELL`
    public static let weeklyCapMPerPlayerPerCell = 2000.0
    /// `BONUS_BIRD_M`
    public static let bonusBirdM = 300.0
    /// `BONUS_PLANT_M`
    public static let bonusPlantM = 200.0
    /// `BONUS_CAP_PER_PLAYER_PER_CELL_PER_WEEK`
    public static let bonusCapPerPlayerPerCellPerWeek = 5
    /// `DECAY` — strength halves every week.
    public static let decay = 0.5
    /// `MIN_STRENGTH_M` — below this no faction can own a cell.
    public static let minStrengthM = 500.0
    /// `HYSTERESIS` — a challenger needs `incumbent × (1 + HYSTERESIS)`.
    public static let hysteresis = 0.10
    /// `PARENT_PLURALITY` — share of claimed children the leader must exceed.
    public static let parentPlurality = 0.40
    /// `PARENT_MIN_CLAIMED_CHILDREN`
    public static let parentMinClaimedChildren = 2
    /// `RECKONING_CRON` — Monday 00:00 UTC, one global cutoff.
    public static let reckoningCron = "0 0 * * 1"
    /// `TZ` — week ids and the reckoning use UTC; only streaks use the player's local zone.
    public static let tz = "UTC"

    // MARK: Walk acceptance thresholds (docs/territory-rules.md "Walk acceptance", data-model.md §2)

    /// `MAX_SAMPLE_HACC_M` — samples with worse horizontal accuracy are dropped.
    public static let maxSampleHAccM = 50.0
    /// `MAX_SAMPLE_SPEED_MPS` — samples reporting a higher speed are dropped.
    public static let maxSampleSpeedMps = 5.0
    /// `TELEPORT_SPEED_MPS` — implied speed between accepted samples above this flags `teleport`.
    public static let teleportSpeedMps = 8.0
    /// `MAX_WALK_MEDIAN_SPEED_MPS` — median implied speed above this flags `speed`.
    public static let maxWalkMedianSpeedMps = 3.5
    /// `MAX_WALK_DISTANCE_M` — longer walks are flagged `distance`.
    public static let maxWalkDistanceM = 30000.0
    /// `MAX_WALK_DURATION_S` — 6 h; longer walks are flagged `distance`.
    public static let maxWalkDurationS = 21600.0
    /// `MIN_STEPS_PER_M` — fewer pedometer steps per metre flags `no_steps`.
    public static let minStepsPerM = 0.5
    /// `NO_STEPS_MIN_DISTANCE_M` — the `no_steps` check applies only above this distance.
    public static let noStepsMinDistanceM = 500.0

    // MARK: Numerical conventions shared with the TypeScript package (plan.md "Shared Rule Semantics")

    /// Sphere radius for haversine distances (item 2).
    public static let earthRadiusM = 6_371_008.8
    /// Bisection stops when the crossing point is located within this distance (item 7).
    public static let bisectionToleranceM = 0.05
    /// Cells credited with less than this are dropped from `pathToHexMeters` output (item 7).
    public static let minHexMetersM = 0.01
    /// Factions whose new strength falls below this are dropped by `reckonWeek` (item 9).
    public static let minRetainedStrengthM = 0.001
}
