#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// Data export (spec US6): pending spinner → "Download" (opens the presigned URL) → failure with retry, or the
/// "still preparing" message after five minutes.
public struct ExportView: View {
    private let viewModel: ProfileViewModel

    public init(viewModel: ProfileViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(
                "Everything we store about you — account, faction history and sessions — as one JSON file. "
                    + "The link works for one hour; the file is kept for seven days."
            )
                .font(Typography.body)
                .foregroundStyle(.secondary)
            content
            Spacer()
        }
        .padding(24)
        .navigationTitle("Export my data")
        .navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("profile.exportScreen")
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.export {
        case .idle:
            primaryButton("Prepare my export") { await viewModel.requestExport() }
        case .pending:
            HStack(spacing: 12) {
                ProgressView()
                Text("Preparing your export… this usually takes under a minute.")
            }
            .accessibilityIdentifier("profile.exportPending")
        case let .ready(url, expiresAt):
            Link(destination: url) {
                Label("Download", systemImage: "arrow.down.circle.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .accessibilityIdentifier("profile.exportDownload")
            if let expiresAt {
                Text("Available until \(expiresAt.formatted(date: .abbreviated, time: .shortened)).")
                    .font(Typography.caption)
                    .foregroundStyle(.secondary)
            }
        case let .failed(message):
            Text(message)
                .foregroundStyle(.red)
                .accessibilityIdentifier("profile.exportError")
            primaryButton("Try again") { await viewModel.requestExport() }
        case .timedOut:
            Text(ExportPresentation.timedOutMessage)
                .accessibilityIdentifier("profile.exportTimedOut")
            primaryButton("Check again") { await viewModel.requestExport() }
        }
    }

    private func primaryButton(_ title: String, action: @escaping @MainActor () async -> Void) -> some View {
        Button {
            Task { await action() }
        } label: {
            Text(title).frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .accessibilityIdentifier("profile.exportAction")
    }
}
#endif
