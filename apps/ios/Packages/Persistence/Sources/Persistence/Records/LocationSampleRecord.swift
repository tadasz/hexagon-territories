import Foundation
import GRDB
import Location
import TerritoryRules

/// Row of `location_sample` (PK `(walk_id, seq)`); `outbox_id` is set once the sample is part of a batch item.
struct LocationSampleRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "location_sample"

    var walkId: String
    var seq: Int
    var ts: Double
    var lat: Double
    var lon: Double
    var hAcc: Double
    var speed: Double?
    var course: Double?
    var alt: Double?
    var accepted: Bool
    var rejectReason: String?
    var outboxId: Int64?

    enum CodingKeys: String, CodingKey {
        case walkId = "walk_id"
        case seq, ts, lat, lon
        case hAcc = "h_acc"
        case speed, course, alt, accepted
        case rejectReason = "reject_reason"
        case outboxId = "outbox_id"
    }

    init(_ recorded: RecordedSample, walkId: String) {
        self.walkId = walkId
        seq = recorded.sample.seq
        ts = recorded.sample.ts.seconds
        lat = recorded.sample.lat
        lon = recorded.sample.lon
        hAcc = recorded.sample.hAcc
        speed = recorded.sample.speed
        course = recorded.sample.course
        alt = recorded.sample.alt
        accepted = recorded.accepted
        rejectReason = recorded.reason?.rawValue
        outboxId = nil
    }

    var sample: Sample {
        Sample(seq: seq, ts: Date(seconds: ts), lat: lat, lon: lon, hAcc: hAcc, speed: speed, course: course, alt: alt)
    }
}
