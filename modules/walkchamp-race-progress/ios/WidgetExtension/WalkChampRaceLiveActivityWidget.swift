import ActivityKit
import SwiftUI
import WalkChampRaceProgress
import WidgetKit

@available(iOS 16.2, *)
struct WalkChampRaceLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WalkChampRaceAttributes.self) { context in
      VStack(alignment: .leading, spacing: 4) {
        Text("Live Race")
          .font(.headline)
        Text("\(context.state.username): \(context.state.raceSteps.formatted()) steps")
        Text("Rank #\(context.state.rank) of \(context.state.totalParticipants)")
        Text("Goal: \(context.state.goalSteps.formatted())")
        Text("Time Left: \(formatTimeLeft(context.state.timeLeftSeconds))")
      }
      .padding()
      .activityBackgroundTint(Color.black.opacity(0.85))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "walkchamp://race/\(context.attributes.raceId)"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("🏃")
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(context.state.raceSteps) • #\(context.state.rank)")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(formatTimeLeft(context.state.timeLeftSeconds))
        }
      } compactLeading: {
        Text("🏃")
      } compactTrailing: {
        Text("\(context.state.raceSteps) • #\(context.state.rank)")
      } minimal: {
        Text("🏃")
      }
      .widgetURL(URL(string: "walkchamp://race/\(context.attributes.raceId)"))
    }
  }

  private func formatTimeLeft(_ seconds: Int) -> String {
    if seconds <= 0 { return "Open" }
    let m = seconds / 60
    let s = seconds % 60
    return String(format: "%d:%02d", m, s)
  }
}
