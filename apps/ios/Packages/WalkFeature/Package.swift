// swift-tools-version: 6.0
// WalkFeature — the Walk tab (research.md R18): recording screen with the live HUD, finish summary sheet, walk
// history with mini paths and the detail view. The view models and presentation helpers are Foundation-only and run
// under `swift test` on Linux; the SwiftUI views are compiled by Xcode (`#if canImport(SwiftUI)`).
import PackageDescription

let package = Package(
    name: "WalkFeature",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "WalkFeature", targets: ["WalkFeature"]),
    ],
    dependencies: [
        .package(path: "../Core"),
        .package(path: "../DesignSystem"),
        .package(path: "../H3Kit"),
        .package(path: "../TerritoryRules"),
        .package(path: "../Location"),
        .package(path: "../Persistence"),
    ],
    targets: [
        .target(
            name: "WalkFeature",
            dependencies: [
                .product(name: "Core", package: "Core"),
                .product(name: "DesignSystem", package: "DesignSystem"),
                .product(name: "H3Kit", package: "H3Kit"),
                .product(name: "TerritoryRules", package: "TerritoryRules"),
                .product(name: "Location", package: "Location"),
                .product(name: "Persistence", package: "Persistence"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "WalkFeatureTests",
            dependencies: [
                "WalkFeature",
                .product(name: "CoreTestSupport", package: "Core"),
                .product(name: "LocationTestSupport", package: "Location"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
