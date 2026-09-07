# ADR 0001: Native iOS app with SwiftUI

**Status**: accepted · **Date**: 2026-09-07

## Context
The product owner wants a native app experience and is willing to ship iPhone first. Background location, audio capture and on-device ML are the core of the product and are where cross-platform frameworks add the most friction.

## Decision
Build the app in Swift 6 and SwiftUI for iOS 17+, MVVM with `@Observable`, feature modules as local Swift packages, XcodeGen for project generation, GRDB for local persistence. Android is a separate later effort.

## Consequences
- Best control over Core Location, AVFoundation and Core ML.
- One codebase to maintain now; a second one later for Android.
- Territory rules must be ported to Swift and kept in parity with the TypeScript package through shared fixtures.

## Alternatives
Expo/React Native (one codebase, weaker background audio/location control), Flutter (same trade-off, less reuse of Apple frameworks), fully native Swift + Kotlin from day one (double the app work).
