// swift-tools-version: 6.0
// FactionsFeature — the faction pick screen (first sign-in) and the Factions tab (spec US2/US4). The view model is
// Foundation-only and tested with `swift test` on Linux; the SwiftUI views are compiled by Xcode.
import PackageDescription

let package = Package(
    name: "FactionsFeature",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "FactionsFeature", targets: ["FactionsFeature"]),
    ],
    dependencies: [
        .package(path: "../Core"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "FactionsFeature",
            dependencies: [
                .product(name: "Core", package: "Core"),
                .product(name: "DesignSystem", package: "DesignSystem"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "FactionsFeatureTests",
            dependencies: [
                "FactionsFeature",
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
