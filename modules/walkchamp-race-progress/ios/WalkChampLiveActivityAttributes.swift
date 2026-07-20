import Foundation
import ActivityKit

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

    public init(
      username: String,
      raceSteps: Int,
      rank: Int,
      totalParticipants: Int,
      goalSteps: Int,
      timeLeftSeconds: Int,
      raceStatus: String,
      lastUpdatedAt: Date
    ) {
      self.username = username
      self.raceSteps = raceSteps
      self.rank = rank
      self.totalParticipants = totalParticipants
      self.goalSteps = goalSteps
      self.timeLeftSeconds = timeLeftSeconds
      self.raceStatus = raceStatus
      self.lastUpdatedAt = lastUpdatedAt
    }
  }

  public var raceId: String
  public var userId: String

  public init(raceId: String, userId: String) {
    self.raceId = raceId
    self.userId = userId
  }
}

@available(iOS 16.2, *)
public struct WalkChampWalkAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    public var todaySteps: Int
    public var dailyGoal: Int
    public var percentComplete: Int
    public var lastUpdatedAt: Date

    public init(
      todaySteps: Int,
      dailyGoal: Int,
      percentComplete: Int,
      lastUpdatedAt: Date
    ) {
      self.todaySteps = todaySteps
      self.dailyGoal = dailyGoal
      self.percentComplete = percentComplete
      self.lastUpdatedAt = lastUpdatedAt
    }
  }

  public var userId: String

  public init(userId: String) {
    self.userId = userId
  }
}
