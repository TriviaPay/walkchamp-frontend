import ActivityKit
import SwiftUI
import WalkChampRaceProgress
import WidgetKit

@available(iOS 16.2, *)
struct WalkChampWalkLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WalkChampWalkAttributes.self) { context in
      VStack(alignment: .leading, spacing: 6) {
        Text("Walk Champ")
          .font(.headline)
        Text("\(context.state.todaySteps.formatted()) total steps today")
          .font(.subheadline)
        Text("Daily goal: \(context.state.percentComplete)%")
          .font(.caption)
      }
      .padding()
      .activityBackgroundTint(Color.black.opacity(0.85))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "globalwalkerleague://walk"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Text("🚶")
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(context.state.todaySteps.formatted()) steps")
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.percentComplete)%")
        }
      } compactLeading: {
        Text("🚶")
      } compactTrailing: {
        Text("\(context.state.todaySteps)")
      } minimal: {
        Text("🚶")
      }
      .widgetURL(URL(string: "globalwalkerleague://walk"))
    }
  }
}
