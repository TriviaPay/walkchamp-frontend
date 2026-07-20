import WidgetKit
import SwiftUI

@main
struct WalkChampWidgetBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      WalkChampWalkLiveActivityWidget()
      WalkChampRaceLiveActivityWidget()
    }
  }
}
