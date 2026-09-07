import Core
import CoreTestSupport
import Foundation
import GRDB
import H3Kit
import Location
import Persistence
import TerritoryRules
import XCTest

/// Shared helpers: an in-memory database with its repository/outbox, and sample builders.
struct Harness {
    let db: DatabaseQueue
    let repository: GRDBWalkRepository
    let outbox: OutboxQueue
    let clock: FakeClock

    init(now: Date = Fixtures.now) throws {
        db = try AppDatabase.inMemory()
        clock = FakeClock(now: now)
        repository = GRDBWalkRepository(db: db, clock: clock)
        outbox = OutboxQueue(db: db)
    }

    /// A recording walk with `count` accepted samples 5 s / 7 m apart (plus `rejected` bad ones at the end).
    @discardableResult
    func recordWalk(id: String, startedAt: Date? = nil, samples count: Int, rejected: Int = 0) throws -> [RecordedSample] {
        let start = startedAt ?? clock.now()
        try repository.createWalk(clientWalkId: id, startedAt: start)
        var recorded: [RecordedSample] = []
        for index in 0..<(count + rejected) {
            let bad = index >= count
            let sample = Sample(
                seq: index,
                ts: start.addingTimeInterval(Double(index) * 5),
                lat: 54.9 + Double(index) * 0.000063,
                lon: 23.9,
                hAcc: bad ? 80 : 8,
                speed: 1.4
            )
            let item = RecordedSample(sample: sample, accepted: !bad, reason: bad ? .accuracy : nil)
            try repository.append(item, walkId: id)
            recorded.append(item)
        }
        return recorded
    }

    func finishInput(id: String, startedAt: Date, endedAt: Date, points: [LatLng] = [], steps: Int? = nil) -> WalkFinishInput {
        WalkFinishInput(
            clientWalkId: id,
            startedAt: startedAt,
            endedAt: endedAt,
            reason: .client,
            progress: WalkProgress(
                distanceM: 321.5,
                movingSeconds: 400,
                hexCount: 2,
                hexEstimates: [HexMeters(cell: H3Index(string: "891f40dabb3ffff")!, meters: 321.5)],
                lastSampleTs: endedAt,
                sampleCount: 80,
                acceptedCount: 79
            ),
            steps: steps,
            points: points
        )
    }
}

extension OutboxItem {
    func decodeBatch() -> SampleBatchRequest? {
        try? JSONCoding.decoder().decode(SampleBatchRequest.self, from: payload)
    }
}
