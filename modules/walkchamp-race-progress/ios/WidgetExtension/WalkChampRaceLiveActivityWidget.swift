import ActivityKit
import SwiftUI
import WalkChampRaceProgress
import WidgetKit

@available(iOS 16.2, *)
struct WalkChampRaceLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WalkChampRaceAttributes.self) { context in
      let pct = racePercent(steps: context.state.raceSteps, goal: context.state.goalSteps)
      let visual = raceVisualName(raceStatus: context.state.raceStatus)
      HStack(alignment: .center, spacing: 12) {
        VStack(alignment: .leading, spacing: 6) {
          HStack(spacing: 8) {
            Image("notification_walkchamp_brand")
              .resizable()
              .scaledToFit()
              .frame(width: 28, height: 28)
              .accessibilityHidden(true)
            Text("WalkChamp")
              .font(.headline)
              .foregroundStyle(.white)
          }
          Text("\(raceTypeLabel(raceStatus: context.state.raceStatus)) • \(formatTimeLeft(context.state.timeLeftSeconds))")
            .font(.caption)
            .foregroundStyle(.white.opacity(0.75))
          Text(context.state.rank == 1 ? "You're in the lead!" : "Keep going, every step counts.")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
          Text("\(context.state.raceSteps.formatted()) / \(context.state.goalSteps.formatted()) steps")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
          ProgressView(value: Double(pct), total: 100)
            .tint(Color(red: 0.49, green: 1.0, blue: 0.70))
          HStack {
            Text("Rank #\(context.state.rank) of \(context.state.totalParticipants)")
            Spacer()
            Text("\(context.state.totalParticipants) Participants")
          }
          .font(.caption2)
          .foregroundStyle(.white.opacity(0.7))
        }

        Spacer(minLength: 4)

        Image(visual)
          .resizable()
          .scaledToFit()
          .frame(width: 52, height: 52)
          .accessibilityHidden(true)
      }
      .padding(12)
      .activityBackgroundTint(Color.black.opacity(0.85))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "walkchamp://race/\(context.attributes.raceId)"))
    } dynamicIsland: { context in
      let visual = raceVisualName(raceStatus: context.state.raceStatus)
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image("notification_walkchamp_brand")
            .resizable()
            .scaledToFit()
            .frame(width: 24, height: 24)
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(context.state.raceSteps.formatted()) • #\(context.state.rank)")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(formatTimeLeft(context.state.timeLeftSeconds))
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.85))
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 8) {
            ProgressView(
              value: Double(racePercent(steps: context.state.raceSteps, goal: context.state.goalSteps)),
              total: 100
            )
            .tint(Color(red: 0.49, green: 1.0, blue: 0.70))
            Image(visual)
              .resizable()
              .scaledToFit()
              .frame(width: 22, height: 22)
            Text("\(context.state.totalParticipants) ppl")
              .font(.caption2)
              .foregroundStyle(.white.opacity(0.7))
          }
        }
      } compactLeading: {
        Image(visual)
          .resizable()
          .scaledToFit()
          .frame(width: 18, height: 18)
      } compactTrailing: {
        Text("#\(context.state.rank)")
          .font(.caption2.weight(.semibold))
      } minimal: {
        Image(systemName: "flag.checkered")
      }
      .widgetURL(URL(string: "walkchamp://race/\(context.attributes.raceId)"))
    }
  }

  private func racePercent(steps: Int, goal: Int) -> Int {
    guard goal > 0 else { return 0 }
    return min(100, max(0, Int((Double(steps) / Double(goal)) * 100.0)))
  }

  private func formatTimeLeft(_ seconds: Int) -> String {
    let s = max(0, seconds)
    if s <= 0 { return "Open" }
    let h = s / 3600
    let m = (s % 3600) / 60
    if h > 0 { return "Ends in \(h)h \(m)m" }
    if m > 0 { return "Ends in \(m)m" }
    return "Ends in \(s)s"
  }

  private func raceTypeLabel(raceStatus: String) -> String {
    // Ongoing Live Activity always shows "Live Race" for every race type.
    _ = raceStatus
    return "Live Race"
  }

  private func raceVisualName(raceStatus: String) -> String {
    // Always the Live Race PNG — never sponsored / coins / cash variants.
    _ = raceStatus
    return "notification_live_race"
  }
}
