import Core
import CoreTestSupport
import Foundation
import XCTest

/// Decodes the examples of `contracts/openapi.yaml` with `JSONCoding` (T017).
final class ModelsDecodingTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONCoding.decoder().decode(type, from: Data(json.utf8))
    }

    func testFactionsResponseExampleDecodes() throws {
        let json = """
        {"factions":[
          {"id":1,"slug":"owls","name":"Owls","emoji":"🦉","colorLight":"#4CAF50","colorDark":"#2E7D32","sort":1,
           "stats":{"members":12,"activeMembers":9,"hexesOwnedR9":0,"hexesOwnedR7":0}},
          {"id":2,"slug":"foxes","name":"Foxes","emoji":"🦊","colorLight":"#FFC107","colorDark":"#FFA000","sort":2,
           "stats":{"members":10,"activeMembers":10,"hexesOwnedR9":0,"hexesOwnedR7":0}},
          {"id":3,"slug":"deer","name":"Deer","emoji":"🦌","colorLight":"#2196F3","colorDark":"#1976D2","sort":3,
           "stats":{"members":4,"activeMembers":3,"hexesOwnedR9":0,"hexesOwnedR7":0}}],
         "suggestedFactionId":3,"activeWindowDays":14}
        """
        let response = try decode(FactionsResponse.self, json)
        XCTAssertEqual(response, Fixtures.factionsResponse())
        XCTAssertEqual(response.faction(id: 2)?.name, "Foxes")
        XCTAssertNil(response.faction(id: nil))
    }

    func testExportStatusExampleDecodes() throws {
        let json = """
        {"id":"1b6f2d3c-4a5b-4c6d-8e9f-0a1b2c3d4e5f","status":"ready","requestedAt":"2026-09-07T10:00:00.000Z",
         "completedAt":"2026-09-07T10:00:04.000Z","expiresAt":"2026-09-14T10:00:04.000Z",
         "downloadUrl":"http://localhost:9000/nature-media/exports/x.json?X-Amz-Signature=abc","error":null}
        """
        let status = try decode(ExportStatus.self, json)
        XCTAssertEqual(status.status, .ready)
        XCTAssertEqual(status.requestedAt, Fixtures.now)
        XCTAssertEqual(status.completedAt, Fixtures.now.addingTimeInterval(4))
        XCTAssertEqual(status.expiresAt, Fixtures.now.addingTimeInterval(7 * 86_400 + 4))
        XCTAssertEqual(status.downloadURL?.host, "localhost")
        XCTAssertNil(status.error)
    }

    func testMeWithNullsDecodes() throws {
        let json = """
        {"id":"9c1f2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f","displayName":"Explorer 4821","factionId":null,
         "factionChangedAt":null,"factionChangeAvailableAt":null,"xp":0,"level":1,"role":"player",
         "createdAt":"2026-08-31T10:00:00.000Z","suggestedFactionId":3}
        """
        let me = try decode(Me.self, json)
        XCTAssertEqual(me, Fixtures.me(factionId: nil))
        XCTAssertFalse(me.hasFaction)
    }

    func testMeWithLockDecodes() throws {
        let json = """
        {"id":"u","displayName":"Ąžuolas","factionId":2,"factionChangedAt":"2026-09-07T10:00:00.000Z",
         "factionChangeAvailableAt":"2026-10-07T10:00:00.000Z","xp":120,"level":2,"role":"tester",
         "createdAt":"2026-08-31T10:00:00Z","suggestedFactionId":1}
        """
        let me = try decode(Me.self, json)
        XCTAssertEqual(me.factionId, 2)
        XCTAssertEqual(me.role, .tester)
        XCTAssertEqual(me.factionChangeAvailableAt, Fixtures.now.addingTimeInterval(30 * 86_400))
        XCTAssertTrue(me.hasFaction)
    }

    func testTokenPairDecodesWithAndWithoutFractionalSeconds() throws {
        let fractional = """
        {"accessToken":"a","accessExpiresAt":"2026-09-07T10:15:00.000Z","refreshToken":"r",
         "refreshExpiresAt":"2026-11-06T10:00:00.000Z"}
        """
        let plain = """
        {"accessToken":"a","accessExpiresAt":"2026-09-07T10:15:00Z","refreshToken":"r",
         "refreshExpiresAt":"2026-11-06T10:00:00Z"}
        """
        let first = try decode(TokenPair.self, fractional)
        let second = try decode(TokenPair.self, plain)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.accessExpiresAt, Fixtures.now.addingTimeInterval(900))
    }

    func testTokenPairRoundTripsThroughJSON() throws {
        let pair = Fixtures.tokenPair()
        let data = try JSONCoding.encoder().encode(pair)
        let text = try XCTUnwrap(String(data: data, encoding: .utf8))
        XCTAssertTrue(text.contains("\"accessExpiresAt\":\"2026-09-07T10:15:00.000Z\""), text)
        XCTAssertEqual(try JSONCoding.decoder().decode(TokenPair.self, from: data), pair)
    }

    func testMalformedDateFails() {
        let json = """
        {"accessToken":"a","accessExpiresAt":"tomorrow","refreshToken":"r","refreshExpiresAt":"2026-11-06T10:00:00Z"}
        """
        XCTAssertThrowsError(try decode(TokenPair.self, json))
    }

    func testAccountDeletionDecodes() throws {
        let json = """
        {"deletedAt":"2026-09-07T10:00:00.000Z","purgeAt":"2026-10-07T10:00:00.000Z"}
        """
        XCTAssertEqual(try decode(AccountDeletion.self, json), Fixtures.accountDeletion())
    }

    func testErrorEnvelopeDecodesDetails() throws {
        let json = """
        {"error":{"code":"FACTION_CHANGE_LOCKED","message":"Faction can be changed once every 30 days",
         "details":{"nextChangeAt":"2026-10-07T10:00:00.000Z"}},"requestId":"6f1c2a4e"}
        """
        let envelope = try decode(ErrorEnvelope.self, json)
        XCTAssertEqual(envelope.error.code, "FACTION_CHANGE_LOCKED")
        XCTAssertEqual(envelope.error.details?["nextChangeAt"], .string("2026-10-07T10:00:00.000Z"))
        XCTAssertEqual(envelope.requestId, "6f1c2a4e")
    }

    func testAppleSignInPayloadOmitsEmptyOptionals() throws {
        let bare = AppleSignInPayload(identityToken: "jwt", fullName: PersonName(givenName: nil, familyName: ""))
        let data = try JSONCoding.encoder().encode(bare)
        XCTAssertEqual(String(data: data, encoding: .utf8), "{\"identityToken\":\"jwt\"}")

        let full = try JSONCoding.encoder().encode(Fixtures.applePayload)
        let text = try XCTUnwrap(String(data: full, encoding: .utf8))
        XCTAssertTrue(text.contains("\"fullName\":{\"givenName\":\"Tadas\"}"), text)
        XCTAssertTrue(text.contains("\"authorizationCode\":\"apple-code\""), text)
    }
}
