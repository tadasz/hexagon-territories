// swift-tools-version: 6.0
// Location — walk recording core (research.md R16): `WalkTracker`, `PathRecorder`, `HexMetersEstimator`,
// `AutoPauseDetector`, `LivePath` and the source/store protocols are Foundation + H3Kit + TerritoryRules only and
// pass `swift test` on Linux (FR-020). The CoreLocation / CoreMotion implementations live in `Sources/Location/Platform`
// behind `#if canImport(...)`, so the same target compiles everywhere and is type-checked by Xcode.
import PackageDescription

let package = Package(
    name: "Location",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "Location", targets: ["Location"]),
        .library(name: "LocationTestSupport", targets: ["LocationTestSupport"]),
    ],
    dependencies: [
        .package(path: "../H3Kit"),
        .package(path: "../TerritoryRules"),
        .package(path: "../Core"),
    ],
    targets: [
        .target(
            name: "Location",
            dependencies: [
                .product(name: "H3Kit", package: "H3Kit"),
                .product(name: "TerritoryRules", package: "TerritoryRules"),
                .product(name: "Core", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .target(
            name: "LocationTestSupport",
            dependencies: [
                "Location",
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "LocationTests",
            dependencies: [
                "Location",
                "LocationTestSupport",
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
