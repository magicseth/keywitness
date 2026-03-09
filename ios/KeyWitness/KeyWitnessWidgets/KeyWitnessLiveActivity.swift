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
                    Image(systemName: "person.fill.checkmark")
                        .font(.title2)
                        .foregroundStyle(.blue)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: Date.now...context.attributes.expiresAt, countsDown: true)
                        .font(.title3.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text("Confirm it's you")
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
                Image(systemName: "person.fill.checkmark")
                    .foregroundStyle(.blue)
            } compactTrailing: {
                Text(timerInterval: Date.now...context.attributes.expiresAt, countsDown: true)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.blue)
            } minimal: {
                Image(systemName: "person.fill.checkmark")
                    .foregroundStyle(.blue)
            }
        }
    }

    @ViewBuilder
    private func lockScreenView(context: ActivityViewContext<KeyWitnessVerificationAttributes>) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "person.fill.checkmark")
                    .font(.title3)
                    .foregroundStyle(.blue)
                Text("Confirm it's you")
                    .font(.headline)
                Spacer()
                Text(timerInterval: Date.now...context.attributes.expiresAt, countsDown: true)
                    .font(.subheadline.monospacedDigit())
                    .foregroundStyle(.secondary)
            }

            Text(context.attributes.messagePreview)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(3)

            Text("Tap to open KeyWitness and verify with Face ID")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .padding()
        .activityBackgroundTint(.black.opacity(0.7))
        .activitySystemActionForegroundColor(.white)
    }
}
