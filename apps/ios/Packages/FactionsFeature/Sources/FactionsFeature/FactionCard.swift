#if canImport(SwiftUI)
import Core
import DesignSystem
import SwiftUI

/// One faction: emoji, name, the stats line and the "Fewest active players" badge on the suggested one. Colours
/// come from the server (`FactionPalette(lightHex:darkHex:)`).
struct FactionCard: View {
    let row: FactionRow
    let activeWindowDays: Int
    let isSelected: Bool
    let isSelectable: Bool
    let onTap: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    private var palette: FactionPalette {
        FactionPalette(lightHex: row.faction.colorLight, darkHex: row.faction.colorDark)
    }

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .top, spacing: 16) {
                Text(row.faction.emoji)
                    .font(.system(size: 40))
                    .frame(width: 56, height: 56)
                    .background(palette.overlayFill, in: RoundedRectangle(cornerRadius: 14))
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Text(row.faction.name)
                            .font(Typography.sectionTitle)
                        if row.isCurrent {
                            tag("Your faction", tint: palette.color(for: colorScheme))
                        }
                    }
                    Text(FactionPickPresentation.statsLine(row.faction.stats, activeWindowDays: activeWindowDays))
                        .font(Typography.caption)
                        .foregroundStyle(.secondary)
                    if row.isSuggested {
                        tag(FactionPickPresentation.suggestedBadge, tint: .green)
                            .accessibilityIdentifier("faction.suggested")
                    }
                }
                Spacer(minLength: 0)
                if isSelected {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(palette.color(for: colorScheme))
                        .font(.title3)
                }
            }
            .padding(16)
            .background(.background, in: RoundedRectangle(cornerRadius: 18))
            .overlay {
                RoundedRectangle(cornerRadius: 18)
                    .stroke(palette.color(for: colorScheme), lineWidth: isSelected ? 3 : 1)
            }
        }
        .buttonStyle(.plain)
        .disabled(!isSelectable)
        .accessibilityIdentifier("faction.card.\(row.faction.slug)")
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func tag(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(Typography.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(tint.opacity(0.15), in: Capsule())
            .foregroundStyle(tint)
    }
}
#endif
