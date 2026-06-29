import Foundation
import ActivityKit
import ExpoModulesCore
import HealthKit

// MARK: - Live Activity attributes (shared with Widget Extension target when added in Xcode)

@available(iOS 16.2, *)
public struct WalkChampRaceAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var username: String
    public var raceSteps: Int
    public var rank: Int
    public var totalParticipants: Int
    public var goalSteps: Int
    public var timeLeftSeconds: Int
    public var raceStatus: String
    public var lastUpdatedAt: Date
  }

  public var raceId: String
  public var userId: String
}

@available(iOS 16.2, *)
public struct WalkChampWalkAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var todaySteps: Int
    public var dailyGoal: Int
    public var percentComplete: Int
    public var lastUpdatedAt: Date
  }

  public var userId: String
}

// MARK: - HealthKit background observer for race step wake-ups

@available(iOS 15.0, *)
final class WalkChampHealthKitRaceObserver {
  static let shared = WalkChampHealthKitRaceObserver()

  private let store = HKHealthStore()
  private var observerQuery: HKObserverQuery?
  private var raceStart: Date?

  var onStepsUpdated: (() -> Void)?

  func start(raceStartAt: Date) {
    guard HKHealthStore.isHealthDataAvailable() else { return }
    stop()
    raceStart = raceStartAt

    guard let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return }

    store.requestAuthorization(toShare: [], read: [stepType]) { _, _ in }

    store.enableBackgroundDelivery(for: stepType, frequency: .immediate) { _, _ in }

    let query = HKObserverQuery(sampleType: stepType, predicate: nil) { [weak self] _, completionHandler, _ in
      self?.onStepsUpdated?()
      completionHandler()
    }
    observerQuery = query
    store.execute(query)
  }

  func stop() {
    if let query = observerQuery {
      store.stop(query)
    }
    observerQuery = nil
    raceStart = nil
  }
}

// MARK: - Race Live Activity manager

@available(iOS 16.2, *)
enum WalkChampRaceLiveActivityManager {
  private static var activities: [String: Activity<WalkChampRaceAttributes>] = [:]
  private static var tokenCache: [String: String] = [:]

  static func start(payload: [String: Any]) async -> [String: String] {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return [:] }
    let raceId = payload["raceId"] as? String ?? ""
    let userId = payload["userId"] as? String ?? ""
    if raceId.isEmpty { return [:] }

    end(raceId: raceId)

    let state = raceContentState(from: payload)
    let attributes = WalkChampRaceAttributes(raceId: raceId, userId: userId)

    do {
      let activity = try Activity.request(
        attributes: attributes,
        content: .init(state: state, staleDate: nil),
        pushType: .token
      )
      activities[raceId] = activity

      let token = await waitForPushToken(activity: activity, raceId: raceId)
      return [
        "activityId": activity.id,
        "pushToken": token,
      ]
    } catch {
      return [:]
    }
  }

  private static func waitForPushToken(
    activity: Activity<WalkChampRaceAttributes>,
    raceId: String,
    timeoutSeconds: Double = 5.0,
  ) async -> String {
    if let cached = tokenCache[raceId], !cached.isEmpty { return cached }

    return await withTaskGroup(of: String?.self) { group in
      group.addTask {
        for await tokenData in activity.pushTokenUpdates {
          let token = tokenData.map { String(format: "%02x", $0) }.joined()
          if !token.isEmpty {
            tokenCache[raceId] = token
            return token
          }
        }
        return nil
      }
      group.addTask {
        try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
        return nil
      }
      for await result in group {
        if let token = result, !token.isEmpty {
          group.cancelAll()
          return token
        }
      }
      return tokenCache[raceId] ?? ""
    }
  }

  static func update(payload: [String: Any]) {
    let raceId = payload["raceId"] as? String ?? ""
    guard let activity = activities[raceId] else { return }
    let state = raceContentState(from: payload)
    Task {
      await activity.update(.init(state: state, staleDate: nil))
    }
  }

  static func end(raceId: String, raceStatus: String = "completed") {
    guard let activity = activities.removeValue(forKey: raceId) else { return }
    tokenCache.removeValue(forKey: raceId)
    let final = WalkChampRaceAttributes.ContentState(
      username: "",
      raceSteps: 0,
      rank: 0,
      totalParticipants: 0,
      goalSteps: 0,
      timeLeftSeconds: 0,
      raceStatus: raceStatus,
      lastUpdatedAt: Date()
    )
    Task {
      await activity.end(.init(state: final, staleDate: nil), dismissalPolicy: .immediate)
    }
  }

  private static func raceContentState(from payload: [String: Any]) -> WalkChampRaceAttributes.ContentState {
    WalkChampRaceAttributes.ContentState(
      username: payload["username"] as? String ?? "Runner",
      raceSteps: intValue(payload["raceSteps"]),
      rank: intValue(payload["rank"], default: 1),
      totalParticipants: intValue(payload["totalParticipants"], default: 1),
      goalSteps: intValue(payload["goalSteps"]),
      timeLeftSeconds: intValue(payload["timeLeftSeconds"]),
      raceStatus: payload["raceStatus"] as? String ?? "in_progress",
      lastUpdatedAt: Date()
    )
  }
}

@available(iOS 16.2, *)
enum WalkChampWalkLiveActivityManager {
  private static var activity: Activity<WalkChampWalkAttributes>?

  static func start(payload: [String: Any]) {
    guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
    end()

    let userId = payload["userId"] as? String ?? "user"
    let state = walkContentState(from: payload)
    let attributes = WalkChampWalkAttributes(userId: userId)

    do {
      activity = try Activity.request(
        attributes: attributes,
        content: .init(state: state, staleDate: nil),
        pushType: nil
      )
    } catch {
      activity = nil
    }
  }

  static func update(payload: [String: Any]) {
    guard let activity else { return }
    let state = walkContentState(from: payload)
    Task {
      await activity.update(.init(state: state, staleDate: nil))
    }
  }

  static func end() {
    guard let activity else { return }
    self.activity = nil
    let final = WalkChampWalkAttributes.ContentState(
      todaySteps: 0,
      dailyGoal: 10_000,
      percentComplete: 0,
      lastUpdatedAt: Date()
    )
    Task {
      await activity.end(.init(state: final, staleDate: nil), dismissalPolicy: .immediate)
    }
  }

  private static func walkContentState(from payload: [String: Any]) -> WalkChampWalkAttributes.ContentState {
    let steps = intValue(payload["todaySteps"])
    let goal = max(1, intValue(payload["dailyGoal"], default: 10_000))
    let pct = min(100, (steps * 100) / goal)
    return WalkChampWalkAttributes.ContentState(
      todaySteps: steps,
      dailyGoal: goal,
      percentComplete: pct,
      lastUpdatedAt: Date()
    )
  }
}

private func intValue(_ value: Any?, default defaultValue: Int = 0) -> Int {
  if let n = value as? Int { return n }
  if let n = value as? NSNumber { return n.intValue }
  if let n = value as? Double { return Int(n) }
  return defaultValue
}

public class WalkChampRaceProgressModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WalkChampRaceProgress")

    Events("onHealthKitRaceStepsWake")

    AsyncFunction("startRaceProgressNotification") { (_: [String: Any]) in
      // Android only
    }

    AsyncFunction("updateRaceProgressNotification") { (_: [String: Any]) in
      // Android only
    }

    AsyncFunction("stopRaceProgressNotification") { (_: [String: Any]) in
      // Android only
    }

    AsyncFunction("startWalkStepNotification") { (_: [String: Any]) in
      // Android only
    }

    AsyncFunction("updateWalkStepNotification") { (_: [String: Any]) in
      // Android only
    }

    AsyncFunction("stopWalkStepNotification") {
      // Android only
    }

    AsyncFunction("startRaceLiveActivity") { (payload: [String: Any]) -> [String: String] in
      if #available(iOS 16.2, *) {
        return await WalkChampRaceLiveActivityManager.start(payload: payload)
      }
      return [:]
    }

    AsyncFunction("updateRaceLiveActivity") { (payload: [String: Any]) in
      if #available(iOS 16.2, *) {
        WalkChampRaceLiveActivityManager.update(payload: payload)
      }
    }

    AsyncFunction("endRaceLiveActivity") { (payload: [String: Any]) in
      if #available(iOS 16.2, *) {
        let raceId = payload["raceId"] as? String ?? ""
        let status = payload["raceStatus"] as? String ?? "completed"
        WalkChampRaceLiveActivityManager.end(raceId: raceId, raceStatus: status)
      }
    }

    AsyncFunction("enableRaceHealthKitBackground") { (raceStartISO: String) in
      if #available(iOS 15.0, *) {
        let formatter = ISO8601DateFormatter()
        let start = formatter.date(from: raceStartISO) ?? Date()
        WalkChampHealthKitRaceObserver.shared.onStepsUpdated = { [weak self] in
          self?.sendEvent("onHealthKitRaceStepsWake", [:])
        }
        WalkChampHealthKitRaceObserver.shared.start(raceStartAt: start)
      }
    }

    AsyncFunction("disableRaceHealthKitBackground") {
      if #available(iOS 15.0, *) {
        WalkChampHealthKitRaceObserver.shared.stop()
      }
    }

    AsyncFunction("startWalkLiveActivity") { (payload: [String: Any]) in
      if #available(iOS 16.2, *) {
        WalkChampWalkLiveActivityManager.start(payload: payload)
      }
    }

    AsyncFunction("updateWalkLiveActivity") { (payload: [String: Any]) in
      if #available(iOS 16.2, *) {
        WalkChampWalkLiveActivityManager.update(payload: payload)
      }
    }

    AsyncFunction("endWalkLiveActivity") {
      if #available(iOS 16.2, *) {
        WalkChampWalkLiveActivityManager.end()
      }
    }
  }
}
