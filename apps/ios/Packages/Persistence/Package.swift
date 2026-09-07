// swift-tools-version: 6.0
// Persistence — the device-side walk storage (research.md R17): GRDB tables `walk`, `location_sample`, `walk_path`,
// `outbox`; `GRDBWalkRepository` (implements `Location.WalkStore` and the history queries), `OutboxQueue`, `Backoff`
// and the `SyncCoordinator` actor that drains the outbox with exponential back-off. GRDB links the system SQLite, so
// `swift test` runs on Linux (needs `sqlite3.h`, e.g. `libsqlite3-dev`) as well as on macOS/iOS.
import PackageDescription

let package = Package(
    name: "Persistence",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "Persistence", targets: ["Persistence"]),
    ],
    dependencies: [
        // MIT (docs/licences.md). Resolved to 7.11.1 on Linux during feature 003; Package.resolved is frozen on macOS.
        .package(url: "https://github.com/groue/GRDB.swift", from: "7.0.0"),
        .package(path: "../Core"),
        .package(path: "../H3Kit"),
        .package(path: "../TerritoryRules"),
        .package(path: "../Location"),
    ],
    targets: [
        .target(
            name: "Persistence",
            dependencies: [
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "Core", package: "Core"),
                .product(name: "H3Kit", package: "H3Kit"),
                .product(name: "TerritoryRules", package: "TerritoryRules"),
                .product(name: "Location", package: "Location"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "PersistenceTests",
            dependencies: [
                "Persistence",
                .product(name: "GRDB", package: "GRDB.swift"),
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
