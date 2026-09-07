import Core
import XCTest

/// The shared vector of `data-model.md` §2.7, verbatim (the API's `display-name.test.ts` runs the same cases).
final class DisplayNameValidatorTests: XCTestCase {
    func testVector() {
        XCTAssertEqual(DisplayNameValidator.validate("Ąžuolas"), .success("Ąžuolas"))
        XCTAssertEqual(DisplayNameValidator.validate("  Tadas  "), .success("Tadas"))
        XCTAssertEqual(DisplayNameValidator.validate("A"), .failure(.tooShort))
        XCTAssertEqual(DisplayNameValidator.validate("   "), .failure(.tooShort))
        XCTAssertEqual(DisplayNameValidator.validate("abcdefghijklmnopqrstuvwxyz"), .failure(.tooLong))
        let twentyFour = String(repeating: "ž", count: 24)
        XCTAssertEqual(DisplayNameValidator.validate(twentyFour), .success(twentyFour))
        XCTAssertEqual(DisplayNameValidator.validate(String(repeating: "ž", count: 25)), .failure(.tooLong))
        XCTAssertEqual(DisplayNameValidator.validate("Ta\nDas"), .failure(.controlCharacter))
        XCTAssertEqual(DisplayNameValidator.validate("🦉 Owl"), .success("🦉 Owl"))
    }

    func testTrimUsesUnicodeWhiteSpace() {
        XCTAssertEqual(DisplayNameValidator.trim("\u{00A0}Tadas\u{2003}\n"), "Tadas")
        XCTAssertEqual(DisplayNameValidator.trim(""), "")
        XCTAssertEqual(DisplayNameValidator.trim("x"), "x")
    }

    func testControlCharactersInsideAreRejectedEvenWhenLongEnough() {
        XCTAssertEqual(DisplayNameValidator.validate("Tab\tName"), .failure(.controlCharacter))
        XCTAssertEqual(DisplayNameValidator.validate("Nul\u{0000}"), .failure(.controlCharacter))
    }

    func testRuleNamesMatchTheAPI() {
        XCTAssertEqual(DisplayNameError.tooShort.rule, "tooShort")
        XCTAssertEqual(DisplayNameError.tooLong.rule, "tooLong")
        XCTAssertEqual(DisplayNameError.controlCharacter.rule, "controlCharacter")
        XCTAssertEqual(DisplayNameValidator.scalarCount("🦉 Owl"), 5)
    }
}
