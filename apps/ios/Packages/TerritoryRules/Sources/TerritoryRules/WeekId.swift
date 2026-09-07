import Foundation

/// ISO week id (`YYYY-Www`) of `date`, computed in UTC — one global cutoff at Monday 00:00 UTC
/// (`docs/territory-rules.md` "Vocabulary", `Rules.tz`). A walk finishing at or after Monday 00:00:00 UTC
/// counts for the new week. research.md R11 defers the shared `week-ids.json` fixture to feature 003; until then
/// this function is covered by unit tests with hand-checked dates only.
public func weekIdFor(_ date: Date) -> String {
    var calendar = Calendar(identifier: .iso8601)
    calendar.timeZone = TimeZone(identifier: Rules.tz) ?? TimeZone(secondsFromGMT: 0)!
    let components = calendar.dateComponents([.yearForWeekOfYear, .weekOfYear], from: date)
    let year = components.yearForWeekOfYear ?? 0
    let week = components.weekOfYear ?? 0
    return String(format: "%04d-W%02d", year, week)
}
