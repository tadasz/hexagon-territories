#if canImport(SwiftUI)
import SwiftUI

/// Walk history (spec US4): newest first, local pending walks on top, "load more" on the last row.
public struct WalkHistoryList: View {
    private let viewModel: WalkHistoryViewModel

    public init(viewModel: WalkHistoryViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        List {
            if let message = viewModel.errorMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            ForEach(viewModel.rows) { row in
                NavigationLink(value: row.id) {
                    WalkHistoryRow(row: row)
                }
                .onAppear {
                    if row.id == viewModel.rows.last?.id, viewModel.canLoadMore {
                        Task { await viewModel.loadMore() }
                    }
                }
            }
            if viewModel.canLoadMore {
                Button("Load more") { Task { await viewModel.loadMore() } }
                    .accessibilityIdentifier("walk.history.loadMore")
            }
            if viewModel.hasLoaded, viewModel.rows.isEmpty, viewModel.errorMessage == nil {
                ContentUnavailableView("No walks yet", systemImage: "figure.walk", description: Text("Your walks appear here."))
            }
        }
        .overlay {
            if viewModel.isLoading, viewModel.rows.isEmpty {
                ProgressView()
            }
        }
        .navigationTitle("Walks")
        .navigationDestination(for: String.self) { id in
            if let row = viewModel.rows.first(where: { $0.id == id }) {
                WalkDetailView(row: row, viewModel: viewModel)
            }
        }
        .refreshable { await viewModel.load() }
        .task { await viewModel.load() }
        .accessibilityIdentifier("walk.history.list")
    }
}
#endif
