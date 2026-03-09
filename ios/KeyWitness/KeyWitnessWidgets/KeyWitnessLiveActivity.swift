import ActivityKit
import SwiftUI
import WidgetKit

struct KeyWitnessLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: KeyWitnessVerificationAttributes.self) { context in
            // Lock Screen / Banner UI
            lockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded view
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: context.state.status == "verified" ? "checkmark.seal.fill" : "person.fill.checkmark")
                        .font(.title2)
                        .foregroundStyle(context.state.status == "verified" ? .green : .blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    expandedTrailing(context: context)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.status == "verified" ? "Identity confirmed" : "Confirm it's you")
                        .font(.headline)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(context.attributes.messagePreview)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                        .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: context.state.status == "verified" ? "checkmark.seal.fill" : "person.fill.checkmark")
                    .foregroundStyle(context.state.status == "verified" ? .green : .blue)
            } compactTrailing: {
                compactTrailingView(context: context)
            } minimal: {
                Image(systemName: context.state.status == "verified" ? "checkmark.seal.fill" : "person.fill.checkmark")
                    .foregroundStyle(context.state.status == "verified" ? .green : .blue)
            }
        }
    }

    @ViewBuilder
    private func expandedTrailing(context: ActivityViewContext<KeyWitnessVerificationAttributes>) -> some View {
        if context.state.status == "verified" {
            Text("Verified")
                .font(.title3)
                .foregroundStyle(.green)
        } else {
            Text(timerInterval: Date.now...context.attributes.expiresAt, countsDown: true)
                .font(.title3.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func compactTrailingView(context: ActivityViewContext<KeyWitnessVerificationAttributes>) -> some View {
        if context.state.status == "verified" {
            Text("Verified")
                .font(.caption)
                .foregroundStyle(.green)
        } else {
            Text(timerInterval: Date.now...context.attributes.expiresAt, countsDown: true)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.blue)
        }
    }

    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<KeyWitnessVerificationAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: context.state.status == "verified" ? "checkmark.seal.fill" : "person.fill.checkmark")
                    .font(.title3)
                    .foregroundStyle(context.state.status == "verified" ? .green : .blue)
                Text(context.state.status == "verified" ? "Identity confirmed" : "Confirm it's you")
                    .font(.headline)
                Spacer()
                lockScreenTrailing(context: context)
            }

            Text(context.attributes.messagePreview)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            if context.state.status != "verified" {
                Text("Tap to open KeyWitness and verify with Face ID")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding()
        .activityBackgroundTint(.black.opacity(0.7))
        .activitySystemActionForegroundColor(.white)
    }

    @ViewBuilder
    private func lockScreenTrailing(context: ActivityViewContext<KeyWitnessVerificationAttributes>) -> some View {
        if context.state.status == "verified" {
            Text("Verified")
                .font(.subheadline)
                .foregroundStyle(.green)
        } else {
            Text(timerInterval: Date.now...context.attributes.expiresAt, countsDown: true)
                .font(.subheadline.monospacedDigit())
                .foregroundStyle(.secondary)
        }
    }
}
