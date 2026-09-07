// swift-tools-version: 6.0
// DesignSystem — faction palette, typography, placeholder screens and the tab model. SwiftUI parts are compiled by Xcode
// (iOS) or `swift build` on macOS and guarded by `#if canImport(SwiftUI)`, so `swift test` on Linux still checks the
// Foundation-only parts (AppTab) and lets the feature packages that depend on this one run their view-model tests.
import PackageDescription

let package = Package(
    name: "DesignSystem",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "DesignSystem", targets: ["DesignSystem"]),
    ],
    targets: [
        .target(
            name: "DesignSystem",
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "DesignSystemTests",
            dependencies: ["DesignSystem"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
