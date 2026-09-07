// swift-tools-version: 6.0
// AuthFeature — Sign in with Apple (research.md R13): the sign-in screen, its view model and the Keychain-backed
// `TokenStore`. The view model and the credential mapping are Foundation-only so `swift test` runs on Linux; the
// SwiftUI screen, the `AuthenticationServices` bridge and the `Security` Keychain code are compiled by Xcode.
import PackageDescription

let package = Package(
    name: "AuthFeature",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AuthFeature", targets: ["AuthFeature"]),
    ],
    dependencies: [
        .package(path: "../Core"),
        .package(path: "../DesignSystem"),
    ],
    targets: [
        .target(
            name: "AuthFeature",
            dependencies: [
                .product(name: "Core", package: "Core"),
                .product(name: "DesignSystem", package: "DesignSystem"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "AuthFeatureTests",
            dependencies: [
                "AuthFeature",
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
