/**
 * Resolves walkchamp:// deep links to expo-router paths.
 * Returns null when the link cannot be parsed safely.
 */
export function resolveDeepLink(raw: string | undefined | null): string | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  let path = trimmed;
  if (path.startsWith("walkchamp://")) {
    path = path.slice("walkchamp://".length);
  } else if (path.startsWith("globalwalkerleague://")) {
    path = path.slice("globalwalkerleague://".length);
  } else if (path.startsWith("/")) {
    return path;
  }

  path = path.replace(/^\/+/, "");

  const [segment, ...rest] = path.split("/").filter(Boolean);
  if (!segment) return "/(tabs)/walk";

  switch (segment) {
    case "chat": {
      const sub = rest[0];
      if (sub === "requests") return "/(tabs)/chat?tab=requests";
      if (sub === "friends") return "/(tabs)/chat?tab=friends";
      if (sub === "private") {
        const conversationId = rest[1];
        if (conversationId) {
          return `/(tabs)/chat?tab=private&conversationId=${encodeURIComponent(conversationId)}`;
        }
        return "/(tabs)/chat?tab=private";
      }
      return "/(tabs)/chat";
    }
    case "groups": {
      const groupId = rest[0];
      if (!groupId) return "/(tabs)/walk";
      const action = rest[1];
      if (action === "requests") return `/groups/${encodeURIComponent(groupId)}?section=requests`;
      if (action === "chat") return `/groups/${encodeURIComponent(groupId)}?section=chat`;
      return `/groups/${encodeURIComponent(groupId)}`;
    }
    case "rooms": {
      if (rest[0] === "join-code") {
        const code = new URLSearchParams(rest.slice(1).join("&").replace("?", "&")).get("code")
          ?? rest.find((p) => p.startsWith("code="))?.split("=")[1];
        if (code) return `/join/${encodeURIComponent(code)}`;
        return "/(tabs)/walk";
      }
      const roomId = rest[0];
      return roomId ? `/race/${encodeURIComponent(roomId)}` : "/(tabs)/walk";
    }
    case "race": {
      const raceId = rest[0];
      return raceId ? `/race/${encodeURIComponent(raceId)}` : "/(tabs)/walk";
    }
    case "walk":
      return "/(tabs)/walk";
    case "wallet":
      return "/(tabs)/wallet";
    case "settings":
      if (rest[0] === "step-tracking") return "/(tabs)/walk?section=step-tracking";
      return "/(tabs)/profile";
    default:
      return "/(tabs)/walk";
  }
}

/**
 * Resolve navigation route from push notification payload.
 */
export function resolveNotificationRoute(data: Record<string, unknown>, launchUrl?: string): string | null {
  const deepLink = typeof data.deepLink === "string" ? data.deepLink : undefined;
  const url = typeof data.url === "string" ? data.url : undefined;
  const resolved = resolveDeepLink(deepLink ?? url ?? launchUrl);
  if (resolved) return resolved;

  const type = typeof data.type === "string" ? data.type : "";
  const roomId = typeof data.room_id === "string" ? data.room_id : undefined;
  const eventId = typeof data.event_id === "string" ? data.event_id : undefined;

  switch (type) {
    case "friend_request":
    case "friend_request_received":
      return "/(tabs)/chat?tab=requests";
    case "friend_request_accepted":
      return "/(tabs)/chat?tab=friends";
    case "race_invite":
    case "race_starting":
    case "race_joined":
    case "coins_battle_joined":
    case "race_finished":
      return roomId ? `/race/${roomId}` : "/(tabs)/walk";
    case "reward_ready":
    case "withdrawal_approved":
      return "/(tabs)/wallet";
    case "group_invite":
      return "/(tabs)/walk";
    case "sponsored_event_reminder":
    case "sponsored_event_started":
    case "sponsored_event_registered":
    case "sponsored_event_winner":
      return eventId ? `/sponsored-event/${eventId}` : "/(tabs)/walk";
    default:
      return "/(tabs)/walk";
  }
}
