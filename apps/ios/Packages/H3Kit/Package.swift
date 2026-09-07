// swift-tools-version: 6.0
// H3Kit — thin Swift wrapper around the vendored Uber H3 C core (Sources/CH3, Apache 2.0).
// Foundation-only: builds and tests with `swift test` on Linux and macOS (research.md R2/R9).
import PackageDescription

let package = Package(
    name: "H3Kit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "H3Kit", targets: ["H3Kit"]),
    ],
    targets: [
        .target(
            name: "CH3",
            path: "Sources/CH3",
            exclude: ["LICENSE", "VERSION"],
            publicHeadersPath: "include",
            cSettings: [
                .headerSearchPath("internal"),
            ],
            linkerSettings: [
                .linkedLibrary("m", .when(platforms: [.linux])),
            ]
        ),
        .target(
            name: "H3Kit",
            dependencies: ["CH3"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
        .testTarget(
            name: "H3KitTests",
            dependencies: ["H3Kit"],
            swiftSettings: [
                .swiftLanguageMode(.v6),
            ]
        ),
    ],
    cLanguageStandard: .c11
)
