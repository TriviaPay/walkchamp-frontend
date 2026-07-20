/**
 * Resolves walkchamp:// / globalwalkerleague:// deep links, HTTPS App Links,
 * and backend path links to expo-router paths.
 */

function resolvePaymentHttpsUrl(url: URL): string | null {
  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path.endsWith("/payment-complete") || path.endsWith("/api/wallet/deposit/done")) {
    // Wallet tab handles the stored payment result — skip intermediate screen.
    return "/(tabs)/wallet";
  }
  return null;
}

export function resolveDeepLink(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // HTTPS Universal Links / App Links (Phase C)
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      const paymentRoute = resolvePaymentHttpsUrl(url);
      if (paymentRoute) return paymentRoute;
    } catch {
      return null;
    }
  }

  let path = trimmed;
  if (path.startsWith("walkchamp://")) {
    path = path.slice("walkchamp://".length);
  } else if (path.startsWith("globalwalkerleague://")) {
    path = path.slice("globalwalkerleague://".length);
  } else if (path.startsWith("/")) {
    return resolveAppPath(path);
  }

  path = path.replace(/^\/+/, "");

  const [segment, ...rest] = path.split("/").filter(Boolean);
  if (!segment) return "/(tabs)/walk";

  switch (segment) {
    case "chat": {
      const sub = rest[0];
      if (sub === "requests") return "/(tabs)/chat?tab=requests";
      if (sub === "friends") return "/(tabs)/chat?tab=private";
      if (sub === "private") {
        const conversationId = rest[1];
        if (conversationId) {
          return `/(tabs)/chat?tab=private&conversationId=${encodeURIComponent(conversationId)}`;
        }
        return "/(tabs)/chat?tab=private";
      }
      return "/(tabs)/chat";
    }
    case "walking-groups":
    case "groups": {
      const groupId = rest[0];
      if (!groupId) return "/groups";
      const action = rest[1];
      if (action === "requests") {
        return `/groups/${encodeURIComponent(groupId)}?section=requests`;
      }
      if (action === "chat") {
        return `/groups/${encodeURIComponent(groupId)}?section=members`;
      }
      return `/groups/${encodeURIComponent(groupId)}`;
    }
    case "rooms": {
      if (rest[0] === "join-code") {
        const queryPart = rest.slice(1).join("/");
        const code =
          new URLSearchParams(queryPart.replace("?", "&")).get("code") ??
          rest.find((p) => p.startsWith("code="))?.split("=")[1];
        if (code) return `/join/${encodeURIComponent(code)}`;
        return "/rooms/available";
      }
      const roomId = rest[0];
      if (!roomId) return "/rooms/available";
      return resolveRaceRoomRoute(roomId);
    }
    case "join": {
      const code = rest[0];
      return code ? `/join/${encodeURIComponent(code)}` : "/rooms/available";
    }
    case "race": {
      const raceId = rest[0];
      return raceId ? `/race/live-detail?id=${encodeURIComponent(raceId)}` : "/(tabs)/walk";
    }
    case "sponsored-events": {
      const eventId = rest[0];
      if (eventId) {
        return `/sponsored-events/waiting-room?id=${encodeURIComponent(eventId)}`;
      }
      return "/sponsored-events";
    }
    case "walk":
      return "/(tabs)/walk";
    case "wallet":
      return "/(tabs)/wallet";
    case "payment-complete":
      return "/(tabs)/wallet";
    case "settings":
      if (rest[0] === "step-tracking") return "/(tabs)/walk?section=step-tracking";
      return "/(tabs)/profile";
    default:
      return "/(tabs)/walk";
  }
}

/** Backend sometimes sends `/public-profile/{userId}` instead of walkchamp:// URLs. */
function resolveAppPath(path: string): string {
  const normalized = path.replace(/^\/+/, "");
  if (normalized.startsWith("public-profile/")) {
    const userId = normalized.slice("public-profile/".length).split("/")[0];
    if (userId) return `/public-profile/${encodeURIComponent(userId)}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function pickString(data: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/** Route to the correct race / room screen for a room or event id. */
export function resolveRaceRoomRoute(roomId: string, notificationType?: string): string {
  if (!roomId) return "/rooms/available";

  const type = notificationType ?? "";
  if (type.startsWith("sponsored_event")) {
    if (
      type === "sponsored_event_started" ||
      type === "sponsored_event_winner" ||
      type === "sponsored_event_consolation"
    ) {
      return `/race/live-detail?id=${encodeURIComponent(roomId)}`;
    }
    return `/sponsored-events/waiting-room?id=${encodeURIComponent(roomId)}`;
  }

  if (
    type === "room_started" ||
    type === "race_starting" ||
    type === "race_joined" ||
    type === "race_finished" ||
    type === "coins_battle_joined" ||
    type === "live_activity_race_update"
  ) {
    return `/race/live-detail?id=${encodeURIComponent(roomId)}`;
  }

  if (type === "room_cancelled") {
    return "/rooms/available";
  }

  if (
    type === "promotional_free_challenge" ||
    type === "promotional_coins_battle" ||
    type === "promotional_cash_challenge" ||
    type === "private_room_invitation" ||
    type === "race_invite" ||
    type === "race_starting_soon"
  ) {
    return `/race/matchmaking?raceId=${encodeURIComponent(roomId)}&isHost=false`;
  }

  return `/race/matchmaking?raceId=${encodeURIComponent(roomId)}&isHost=false`;
}

/**
 * Resolve navigation route from push notification payload.
 * Prefers deepLink / url / OneSignal launch URL, then falls back to type + ids.
 */
export function resolveNotificationRoute(
  data: Record<string, unknown>,
  launchUrl?: string,
): string | null {
  const type = pickString(data, "type") ?? "";
  const eventType = pickString(data, "eventType", "event_type");

  if (type === "race_starting_soon") {
    if (eventType === "sponsored_event") {
      const eventId = pickString(data, "eventId", "event_id", "room_id");
      return eventId
        ? `/sponsored-events/waiting-room?id=${encodeURIComponent(eventId)}`
        : "/sponsored-events";
    }
    const raceId = pickString(data, "raceId", "race_id", "roomId", "room_id");
    return raceId
      ? `/race/matchmaking?raceId=${encodeURIComponent(raceId)}&isHost=false`
      : "/rooms/available";
  }

  const screen = pickString(data, "screen");
  if (screen === "race_waiting_room") {
    const raceId = pickString(data, "raceId", "race_id", "roomId", "room_id");
    return raceId
      ? `/race/matchmaking?raceId=${encodeURIComponent(raceId)}&isHost=false`
      : "/rooms/available";
  }
  if (screen === "sponsored_waiting_room") {
    const eventId = pickString(data, "eventId", "event_id", "room_id");
    return eventId
      ? `/sponsored-events/waiting-room?id=${encodeURIComponent(eventId)}`
      : "/sponsored-events";
  }

  const deepLink = pickString(data, "deepLink", "deep_link");
  const url = pickString(data, "url");
  const resolved = resolveDeepLink(deepLink ?? url ?? launchUrl);
  if (resolved) return resolved;

  if (screen === "walk") return "/(tabs)/walk";

  const roomId = pickString(data, "roomId", "room_id");
  const eventId = pickString(data, "eventId", "event_id", "room_id");
  const groupId = pickString(data, "walkingGroupId", "walking_group_id", "groupId", "group_id");
  const conversationId = pickString(data, "conversationId", "conversation_id");
  const friendId = pickString(data, "friendId", "friend_id", "senderUserId", "sender_user_id");
  const roomCode = pickString(data, "roomCode", "room_code");
  const profileUserId = pickString(data, "senderUserId", "sender_user_id", "userId", "user_id");

  switch (type) {
    case "friend_request":
    case "friend_request_received":
      return "/(tabs)/chat?tab=requests";

    case "friend_request_accepted":
      if (friendId) {
        return `/(tabs)/chat?tab=private&friendId=${encodeURIComponent(friendId)}`;
      }
      return "/(tabs)/chat?tab=private";

    case "friend_request_rejected":
      return "/(tabs)/chat?tab=private";

    case "chat_message_received":
      if (conversationId) {
        return `/(tabs)/chat?tab=private&conversationId=${encodeURIComponent(conversationId)}`;
      }
      return "/(tabs)/chat?tab=private";

    case "friend_daily_goal_completed":
      if (profileUserId) return `/public-profile/${encodeURIComponent(profileUserId)}`;
      return "/(tabs)/walk";

    case "daily_goal_reminder":
      return "/(tabs)/walk";

    case "walking_group_invite_received":
    case "walking_group_request_accepted":
    case "walking_group_request_rejected":
      return groupId ? `/groups/${encodeURIComponent(groupId)}` : "/groups";

    case "walking_group_join_request_received":
      return groupId
        ? `/groups/${encodeURIComponent(groupId)}?section=requests`
        : "/groups";

    case "group_daily_goal_completed":
      return groupId ? `/groups/${encodeURIComponent(groupId)}` : "/groups";

    case "race_starting_soon": {
      if (eventType === "sponsored_event") {
        const sponsoredEventId = pickString(data, "eventId", "event_id", "room_id");
        return sponsoredEventId
          ? `/sponsored-events/waiting-room?id=${encodeURIComponent(sponsoredEventId)}`
          : "/sponsored-events";
      }
      const registeredRaceId = pickString(data, "raceId", "race_id", "roomId", "room_id");
      return registeredRaceId
        ? `/race/matchmaking?raceId=${encodeURIComponent(registeredRaceId)}&isHost=false`
        : "/rooms/available";
    }

    case "group_invite_accepted":
      return groupId ? `/groups/${encodeURIComponent(groupId)}` : "/groups";

    case "private_room_invitation":
      if (roomCode) return `/join/${encodeURIComponent(roomCode)}`;
      return roomId ? resolveRaceRoomRoute(roomId, type) : "/rooms/available";

    case "promotional_rooms_available":
      return "/rooms/available";

    case "promotional_free_challenge":
    case "promotional_coins_battle":
    case "promotional_cash_challenge":
      return roomId ? resolveRaceRoomRoute(roomId, type) : "/rooms/available";

    case "promotional_sponsored_event":
      return eventId
        ? `/sponsored-events/waiting-room?id=${encodeURIComponent(eventId)}`
        : "/sponsored-events";

    case "sponsored_event_started":
    case "sponsored_event_winner":
    case "sponsored_event_consolation":
      return roomId
        ? resolveRaceRoomRoute(roomId, type)
        : "/sponsored-events";

    case "sponsored_event_registered":
    case "sponsored_event_left":
    case "sponsored_event_reminder":
      return roomId
        ? `/sponsored-events/waiting-room?id=${encodeURIComponent(roomId)}`
        : "/sponsored-events";

    case "race_invite":
    case "race_starting":
    case "race_joined":
    case "coins_battle_joined":
    case "race_finished":
    case "room_started":
    case "live_activity_race_update":
      return roomId ? resolveRaceRoomRoute(roomId, type) : "/rooms/available";

    case "room_cancelled":
      return "/rooms/available";

    case "reward_ready":
    case "withdrawal_approved":
      return "/(tabs)/wallet";

    case "title_unlocked":
      return "/(tabs)/profile?openTitles=1";

    case "group_invite":
      return groupId ? `/groups/${encodeURIComponent(groupId)}` : "/groups";

    default:
      if (roomId) return resolveRaceRoomRoute(roomId, type);
      return "/(tabs)/walk";
  }
}
