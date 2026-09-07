// swift-tools-version: 6.0
// ProfileFeature — the Profile tab: display name, sign out, account deletion and data export (spec US3/US5/US6).
// The view model is Foundation-only and tested with `swift test` on Linux; the SwiftUI views are compiled by Xcode.
import PackageDescription

let package = Package(
    name: "ProfileFeature",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "ProfileFeature", targets: ["ProfileFeature"]),
    ],
    dependencies: [
        .package(path: "../Core"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "ProfileFeature",
            dependencies: [
                .product(name: "Core", package: "Core"),
                .product(name: "DesignSystem", package: "DesignSystem"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "ProfileFeatureTests",
            dependencies: [
                "ProfileFeature",
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
