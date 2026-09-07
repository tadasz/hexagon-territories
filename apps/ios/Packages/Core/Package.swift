// swift-tools-version: 6.0
// Core — Foundation-only models, service protocols, the `AuthSession` actor, validators and presentation logic shared
// by every feature package (`docs/architecture.md` §4: feature packages depend only on core packages; research.md R12).
// Builds and passes `swift test` on Linux and macOS (FR-016, SC-008). `CoreTestSupport` ships the fakes used by the
// feature packages' and the app target's tests so each fake exists once.
import PackageDescription

let package = Package(
    name: "Core",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "Core", targets: ["Core"]),
        .library(name: "CoreTestSupport", targets: ["CoreTestSupport"]),
    ],
    targets: [
        .target(
            name: "Core",
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .target(
            name: "CoreTestSupport",
            dependencies: ["Core"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "CoreTests",
            dependencies: ["Core", "CoreTestSupport"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
