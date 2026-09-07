import Foundation
import GRDB
import H3Kit
import TerritoryRules

/// Row of `walk_path`: the accepted points (`[[lat, lon], …]`) and the estimate per cell (`{"h3": metres}`) as JSON.
struct WalkPathRecord: Codable, FetchableRecord, PersistableRecord, Equatable {
    static let databaseTableName = "walk_path"

    var walkId: String
    var points: Data
    var hexEstimates: Data
    var updatedAt: Double

    enum CodingKeys: String, CodingKey {
        case walkId = "walk_id"
        case points
        case hexEstimates = "hex_estimates"
        case updatedAt = "updated_at"
    }

    static func encode(points: [LatLng]) -> Data {
        (try? JSONEncoder().encode(points.map { [$0.lat, $0.lon] })) ?? Data("[]".utf8)
    }

    static func decodePoints(_ data: Data) -> [LatLng] {
        ((try? JSONDecoder().decode([[Double]].self, from: data)) ?? [])
            .compactMap { $0.count >= 2 ? LatLng(lat: $0[0], lon: $0[1]) : nil }
    }

    static func encode(hexEstimates: [HexMeters]) -> Data {
        let object = Dictionary(uniqueKeysWithValues: hexEstimates.map { ($0.cell.description, $0.meters) })
        return (try? JSONEncoder().encode(object)) ?? Data("{}".utf8)
    }

    static func decodeHexEstimates(_ data: Data) -> [HexMeters] {
        ((try? JSONDecoder().decode([String: Double].self, from: data)) ?? [:])
            .compactMap { key, value in H3Index(string: key).map { HexMeters(cell: $0, meters: value) } }
            .sorted { $0.cell.description < $1.cell.description }
    }
}
