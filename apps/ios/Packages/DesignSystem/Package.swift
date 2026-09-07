// swift-tools-version: 6.0
// DesignSystem — faction palette, typography, placeholder screens and the tab model. SwiftUI: compiled by Xcode
// (iOS) or `swift build` on macOS; not part of Linux CI (research.md R9).
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
