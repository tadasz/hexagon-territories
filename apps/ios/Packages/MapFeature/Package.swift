// swift-tools-version: 6.0
// MapFeature — MapLibre Native wrapper (`MapLibreView`), map configuration and the Map tab screen.
// iOS only (MapLibre's iOS distribution); compiled by Xcode / Xcode Cloud, excluded from Linux CI (research.md R9).
import PackageDescription

let package = Package(
    name: "MapFeature",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "MapFeature", targets: ["MapFeature"]),
    ],
    dependencies: [
        // ADR 0003: MapLibre Native iOS 6.x, pinned to a 6.x minor; the exact version is frozen in Package.resolved.
        .package(url: "https://github.com/maplibre/maplibre-gl-native-distribution", from: "6.0.0"),
    ],
    targets: [
        .target(
            name: "MapFeature",
            dependencies: [
                .product(name: "MapLibre", package: "maplibre-gl-native-distribution"),
            ],
            exclude: ["Resources/README.md"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "MapFeatureTests",
            dependencies: ["MapFeature"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
