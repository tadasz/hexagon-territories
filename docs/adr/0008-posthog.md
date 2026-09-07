# ADR 0008: PostHog for analytics, feature flags and crash reporting

**Status**: accepted · **Date**: 2026-09-07

## Decision
Use PostHog EU Cloud for product analytics, feature flags and error tracking on iOS (`posthog-ios`, exception autocapture) and on the API (`posthog-node`). Events never carry location finer than an H3 resolution-7 cell.

## Consequences
- One vendor, EU data residency.
- PostHog's iOS error tracking is marked experimental; Xcode Organizer crash reports remain the baseline, and Sentry is reconsidered only if crashes are missed during the MVP beta.

## Alternatives
Amplitude + Sentry, TelemetryDeck + Crashlytics.
