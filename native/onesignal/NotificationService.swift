import UserNotifications
import OneSignalExtension

/// Walk Champ OneSignal Notification Service Extension.
/// Attaches a notification-type illustration as rich media when possible.
/// Left-side app icon remains the system-controlled Walk Champ icon.
/// Falls back to the original payload if attachment fails or times out.
class NotificationService: UNNotificationServiceExtension {
  var contentHandler: ((UNNotificationContent) -> Void)?
  var receivedRequest: UNNotificationRequest!
  var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.receivedRequest = request
    self.contentHandler = contentHandler
    self.bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

    guard let bestAttemptContent = bestAttemptContent else {
      contentHandler(request.content)
      return
    }

    attachTypeIllustrationIfNeeded(to: bestAttemptContent)

    OneSignalExtension.didReceiveNotificationExtensionRequest(
      self.receivedRequest,
      with: bestAttemptContent,
      withContentHandler: self.contentHandler
    )
  }

  override func serviceExtensionTimeWillExpire() {
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      OneSignalExtension.serviceExtensionTimeWillExpireRequest(
        self.receivedRequest,
        with: self.bestAttemptContent
      )
      contentHandler(bestAttemptContent)
    }
  }

  /// Prefer server-provided image URL; otherwise attach a bundled notification_*.png by visual type.
  private func attachTypeIllustrationIfNeeded(to content: UNMutableNotificationContent) {
    if content.attachments.isEmpty == false { return }

    let userInfo = content.userInfo
    let data = extractAdditionalData(from: userInfo)
    let visualKey = stringValue(data["visualType"])
      ?? stringValue(data["visual_type"])
      ?? stringValue(data["type"])
      ?? stringValue(data["notificationType"])
      ?? "default"

    let assetName = Self.drawableName(for: visualKey)

    // Hosted URL wins when present (backend / OneSignal dashboard).
    if let urlString = stringValue(data["image"])
      ?? stringValue(data["big_picture"])
      ?? stringValue(data["ios_attachment"])
      ?? stringValue(data["attachment"]),
      let url = URL(string: urlString),
      let scheme = url.scheme?.lowercased(),
      scheme == "https" || scheme == "http"
    {
      if let attachment = try? downloadAttachment(from: url, identifier: assetName) {
        content.attachments = [attachment]
        return
      }
    }

    if let attachment = try? bundleAttachment(named: assetName) {
      content.attachments = [attachment]
    }
  }

  private func extractAdditionalData(from userInfo: [AnyHashable: Any]) -> [String: Any] {
    if let custom = userInfo["custom"] as? [String: Any],
       let additional = custom["a"] as? [String: Any]
    {
      return additional
    }
    if let additional = userInfo["additionalData"] as? [String: Any] {
      return additional
    }
    if let additional = userInfo["a"] as? [String: Any] {
      return additional
    }
    return userInfo.reduce(into: [String: Any]()) { result, entry in
      if let key = entry.key as? String {
        result[key] = entry.value
      }
    }
  }

  private func stringValue(_ value: Any?) -> String? {
    guard let value else { return nil }
    if let s = value as? String, s.isEmpty == false { return s }
    if let n = value as? NSNumber { return n.stringValue }
    return nil
  }

  private func bundleAttachment(named name: String) throws -> UNNotificationAttachment {
    let candidates = [name, "notification_default"]
    for candidate in candidates {
      if let url = Bundle.main.url(forResource: candidate, withExtension: "png") {
        return try UNNotificationAttachment(
          identifier: candidate,
          url: url,
          options: [UNNotificationAttachmentOptionsTypeHintKey: "public.png"]
        )
      }
    }
    throw NSError(domain: "WalkChampNSE", code: 404, userInfo: [
      NSLocalizedDescriptionKey: "Missing bundled notification image \(name)",
    ])
  }

  private func downloadAttachment(from url: URL, identifier: String) throws -> UNNotificationAttachment {
    let data = try Data(contentsOf: url, options: [.mappedIfSafe])
    let tmp = FileManager.default.temporaryDirectory
      .appendingPathComponent("\(identifier)-\(UUID().uuidString).png")
    try data.write(to: tmp, options: [.atomic])
    return try UNNotificationAttachment(
      identifier: identifier,
      url: tmp,
      options: [UNNotificationAttachmentOptionsTypeHintKey: "public.png"]
    )
  }

  /// Mirrors `constants/notificationVisuals.ts` drawable names.
  private static func drawableName(for raw: String) -> String {
    let key = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    let mapped: [String: String] = [
      "friend_request": "friend",
      "friend_request_received": "friend",
      "friend_request_accepted": "friend",
      "friend_request_rejected": "friend",
      "friend_daily_goal_completed": "goal_completed",
      "chat_message_received": "chat",
      "daily_goal_reminder": "goal_progress",
      "walking_group_invite_received": "group",
      "walking_group_request_accepted": "group",
      "walking_group_request_rejected": "group",
      "walking_group_join_request_received": "group",
      "group_daily_goal_completed": "goal_completed",
      "group_invite": "group",
      "group_invite_accepted": "group",
      "race_invite": "room_invite",
      "race_starting_soon": "upcoming_race",
      "race_starting": "race_started",
      "race_joined": "live_race",
      "race_finished": "race_finished",
      "room_started": "race_started",
      "room_cancelled": "room_cancelled",
      "private_room_invitation": "room_invite",
      "live_activity_race_update": "live_race",
      "coins_battle_joined": "coins_battle",
      "promotional_coins_battle": "coins_battle",
      "promotional_cash_challenge": "cash_challenge",
      "sponsored_event_registered": "sponsored_event",
      "sponsored_event_left": "sponsored_event",
      "sponsored_event_reminder": "upcoming_race",
      "sponsored_event_started": "race_started",
      "sponsored_event_winner": "winner",
      "sponsored_event_consolation": "reward",
      "promotional_sponsored_event": "sponsored_event",
      "promotional_rooms_available": "promotion",
      "promotional_free_challenge": "promotion",
      "reward_ready": "reward",
      "withdrawal_approved": "wallet",
      "title_unlocked": "title_unlocked",
    ]

    let visual = mapped[key] ?? key
    switch visual {
    case "daily_walk": return "notification_daily_walk"
    case "goal_progress": return "notification_goal_progress"
    case "goal_completed": return "notification_goal_completed"
    case "live_race": return "notification_live_race"
    case "upcoming_race": return "notification_upcoming_race"
    case "race_started": return "notification_race_started"
    case "race_finished": return "notification_race_finished"
    case "winner": return "notification_winner_trophy"
    case "coins_battle": return "notification_coins_battle"
    case "cash_challenge": return "notification_cash_challenge"
    case "sponsored_event": return "notification_sponsored_event"
    case "room_invite": return "notification_room_invite"
    case "room_cancelled": return "notification_room_cancelled"
    case "friend": return "notification_friend"
    case "chat": return "notification_chat"
    case "group": return "notification_group"
    case "reward": return "notification_reward"
    case "wallet": return "notification_wallet"
    case "title_unlocked": return "notification_title_unlocked"
    case "promotion": return "notification_promotion"
    default: return "notification_default"
    }
  }
}
