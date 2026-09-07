// swift-tools-version: 6.0
// TerritoryRules — Swift mirror of `@nature/territory-rules` (Constitution II). Foundation + H3Kit only, so it
// builds and passes `swift test` on Linux and macOS against the shared fixtures in packages/h3-fixtures.
import PackageDescription

let package = Package(
    name: "TerritoryRules",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "TerritoryRules", targets: ["TerritoryRules"]),
    ],
    dependencies: [
        .package(path: "../H3Kit"),
    ],
    targets: [
        .target(
            name: "TerritoryRules",
            dependencies: [
                .product(name: "H3Kit", package: "H3Kit"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "TerritoryRulesTests",
            dependencies: ["TerritoryRules"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
