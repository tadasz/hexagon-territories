// swift-tools-version: 6.0
// APIClient — the generated OpenAPI client (swift-openapi-generator build plugin over Sources/APIClient/openapi.json,
// a copy of packages/api-schema/openapi.json kept in sync by apps/ios/scripts/sync-openapi.sh), the bearer/refresh
// middleware and the adapters that implement the `Core` service protocols (research.md R11; constitution: "the iOS
// client is generated, never hand-written"). Nothing generated is committed. Builds on macOS/Xcode Cloud and, when
// SwiftPM can reach GitHub, on Linux.
import PackageDescription

let package = Package(
    name: "APIClient",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "APIClient", targets: ["APIClient"]),
    ],
    dependencies: [
        // `namingStrategy: idiomatic` in openapi-generator-config.yaml needs generator 1.6+.
        .package(url: "https://github.com/apple/swift-openapi-generator", from: "1.6.0"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", from: "1.0.0"),
        .package(url: "https://github.com/apple/swift-http-types", from: "1.0.0"),
        .package(path: "../Core"),
    ],
    targets: [
        .target(
            name: "APIClient",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "Core", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
        .testTarget(
            name: "APIClientTests",
            dependencies: [
                "APIClient",
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "HTTPTypes", package: "swift-http-types"),
                .product(name: "Core", package: "Core"),
                .product(name: "CoreTestSupport", package: "Core"),
            ],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ]
)
