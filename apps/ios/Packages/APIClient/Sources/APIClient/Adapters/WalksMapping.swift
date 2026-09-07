import Core
import Foundation
import OpenAPIRuntime

// Generated walk types ↔ `Core` walk models (feature 003). One file, like `Mapping.swift` for 002.

extension Components.Schemas.WalkCreateRequest {
    init(_ request: WalkCreateRequest) {
        self.init(
            clientWalkId: request.clientWalkId,
            startedAt: request.startedAt,
            deviceInfo: request.deviceInfo.map {
                .init(model: $0.model, osVersion: $0.osVersion, appVersion: $0.appVersion)
            }
        )
    }
}

extension Components.Schemas.WalkCreated {
    var core: WalkCreated {
        WalkCreated(
            walkId: walkId,
            clientWalkId: clientWalkId,
            startedAt: startedAt,
            status: WalkStatus(rawValue: status.rawValue) ?? .active,
            supersededWalkId: supersededWalkId
        )
    }
}

extension Components.Schemas.LocationSample {
    init(_ sample: LocationSample) {
        self.init(
            seq: sample.seq,
            ts: sample.ts,
            lat: sample.lat,
            lon: sample.lon,
            hAcc: sample.hAcc,
            speed: sample.speed,
            course: sample.course,
            alt: sample.alt
        )
    }
}

extension Components.Schemas.SampleBatchRequest {
    init(_ batch: SampleBatchRequest) {
        self.init(
            samples: batch.samples.map(Components.Schemas.LocationSample.init),
            pedometer: batch.pedometer.map { .init(steps: $0.steps, since: $0.since, until: $0.until) }
        )
    }
}

extension Components.Schemas.SampleBatchResult {
    var core: SampleBatchResult {
        SampleBatchResult(
            stored: stored,
            duplicates: duplicates,
            accepted: accepted,
            rejected: rejected.map { RejectedSampleDTO(seq: $0.seq, reason: SampleRejectReason(rawValue: $0.reason.rawValue) ?? .accuracy) },
            sampleCount: sampleCount
        )
    }
}

extension Components.Schemas.WalkFinishRequest {
    init(_ request: WalkFinishRequest) {
        self.init(endedAt: request.endedAt, pedometerTotal: request.pedometerTotal)
    }
}

extension Components.Schemas.WeekStanding {
    var core: WeekStanding {
        WeekStanding(leader: leader, myFactionShare: myFactionShare, owner: owner)
    }
}

extension Components.Schemas.WalkHex {
    var core: WalkHex {
        WalkHex(h3: h3, meters: meters, cappedMeters: cappedMeters, weekStanding: weekStanding.core)
    }
}

extension Components.Schemas.LineString {
    var core: LineString {
        LineString(coordinates: coordinates)
    }
}

extension Components.Schemas.WalkSummary.PathPayload {
    /// `path` is generated as an inline nullable object (see `x-source` in openapi.json); same shape as `LineString`.
    var core: LineString {
        LineString(coordinates: coordinates)
    }
}

extension Components.Schemas.WalkSummary {
    var core: WalkSummary {
        WalkSummary(
            walkId: walkId,
            clientWalkId: clientWalkId,
            status: WalkStatus(rawValue: status.rawValue) ?? .finished,
            finishReason: finishReason.flatMap { FinishReason(rawValue: $0.rawValue) },
            startedAt: startedAt,
            endedAt: endedAt,
            finishedAt: finishedAt,
            weekId: weekId,
            distanceM: distanceM,
            durationS: durationS,
            steps: steps,
            sampleCount: sampleCount,
            hexCount: hexCount,
            xp: xp,
            scored: scored,
            flags: flags.compactMap { WalkFlag(rawValue: $0.rawValue) },
            hexes: hexes.map(\.core),
            path: path.map(\.core)
        )
    }
}

extension Components.Schemas.WalkListItem {
    var core: WalkListItem {
        WalkListItem(
            walkId: walkId,
            clientWalkId: clientWalkId,
            status: WalkStatus(rawValue: status.rawValue) ?? .finished,
            finishReason: finishReason.flatMap { FinishReason(rawValue: $0.rawValue) },
            startedAt: startedAt,
            endedAt: endedAt,
            weekId: weekId,
            distanceM: distanceM,
            durationS: durationS,
            hexCount: hexCount,
            xp: xp,
            scored: scored,
            flags: flags.compactMap { WalkFlag(rawValue: $0.rawValue) }
        )
    }
}

extension Components.Schemas.WalkListPage {
    var core: WalkListPage {
        WalkListPage(items: items.map(\.core), nextCursor: nextCursor)
    }
}
