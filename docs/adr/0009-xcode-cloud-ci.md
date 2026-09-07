# ADR 0009: Xcode Cloud for iOS CI/CD, GitHub Actions for the rest

**Status**: accepted · **Date**: 2026-09-07

## Decision
iOS builds, unit tests and TestFlight distribution run on Xcode Cloud (PR workflow: build + unit tests; merge workflow: tests + TestFlight internal; tag workflow: TestFlight external / App Store). `apps/ios/ci_scripts/ci_post_clone.sh` installs XcodeGen, generates the project and pulls git-lfs models. The API, TypeScript packages and ML eval run on GitHub Actions with a Postgres + PostGIS + h3-pg service container.

## Consequences
- 25 compute hours per month are included with the developer program; PR workflows are limited to unit tests and XCUITests run nightly to stay within budget.
- Two CI systems; fixture parity between Swift and TypeScript is enforced by both suites reading the same committed JSON.
- Xcode Cloud is connected to the repository in App Store Connect by the owner (manual step).
