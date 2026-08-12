import ActivityKit
import SwiftUI
import WalkChampRaceProgress
import WidgetKit

@available(iOS 16.2, *)
struct WalkChampWalkLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: WalkChampWalkAttributes.self) { context in
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
          Text("Daily Walk")
            .font(.caption)
            .foregroundStyle(.white.opacity(0.75))
          Text("\(context.state.todaySteps.formatted()) / \(context.state.dailyGoal.formatted()) steps")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
          ProgressView(value: Double(min(100, max(0, context.state.percentComplete))), total: 100)
            .tint(Color(red: 0.49, green: 1.0, blue: 0.70))
          Text("\(max(0, context.state.dailyGoal - context.state.todaySteps).formatted()) remaining • \(context.state.percentComplete)%")
            .font(.caption2)
            .foregroundStyle(.white.opacity(0.7))
        }

        Spacer(minLength: 4)

        Image(walkVisualName(percent: context.state.percentComplete))
          .resizable()
          .scaledToFit()
          .frame(width: 52, height: 52)
          .accessibilityHidden(true)
      }
      .padding(12)
      .activityBackgroundTint(Color.black.opacity(0.85))
      .activitySystemActionForegroundColor(.white)
      .widgetURL(URL(string: "globalwalkerleague://walk"))
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Image("notification_walkchamp_brand")
            .resizable()
            .scaledToFit()
            .frame(width: 24, height: 24)
        }
        DynamicIslandExpandedRegion(.center) {
          Text("\(context.state.todaySteps.formatted()) / \(context.state.dailyGoal.formatted())")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text("\(context.state.percentComplete)%")
            .font(.caption.weight(.bold))
            .foregroundStyle(.green)
        }
        DynamicIslandExpandedRegion(.bottom) {
          HStack(spacing: 8) {
            ProgressView(value: Double(min(100, max(0, context.state.percentComplete))), total: 100)
              .tint(Color(red: 0.49, green: 1.0, blue: 0.70))
            Image(walkVisualName(percent: context.state.percentComplete))
              .resizable()
              .scaledToFit()
              .frame(width: 22, height: 22)
          }
        }
      } compactLeading: {
        Image(walkVisualName(percent: context.state.percentComplete))
          .resizable()
          .scaledToFit()
          .frame(width: 18, height: 18)
      } compactTrailing: {
        Text("\(context.state.percentComplete)%")
          .font(.caption2.weight(.semibold))
      } minimal: {
        Image(systemName: "figure.walk")
      }
      .widgetURL(URL(string: "globalwalkerleague://walk"))
    }
  }

  private func walkVisualName(percent: Int) -> String {
    percent >= 100 ? "notification_goal_completed" : "notification_daily_walk"
  }
}
