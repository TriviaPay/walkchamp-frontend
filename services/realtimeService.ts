import type { Channel } from "pusher-js";
import { getStoredSession } from "./authService";
import { markPusherConnected, markPusherEvent } from "./pusherHealth";
import { perf } from "@/utils/perfLogger";

type PusherClass = typeof import("pusher-js").default;
type PusherInstance = InstanceType<PusherClass>;

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";
const PUSHER_KEY = process.env.EXPO_PUBLIC_PUSHER_KEY ?? "";
const PUSHER_CLUSTER = process.env.EXPO_PUBLIC_PUSHER_CLUSTER ?? "mt1";

let _client: PusherInstance | null = null;

// ── ChannelAdapter ─────────────────────────────────────────────────────────────
// Thin wrapper so call sites don't need to change when we swap Pusher internals.
export class ChannelAdapter {
  private _channel: Channel;
  private _wrappers = new WeakMap<(data: unknown) => void, (data: unknown) => void>();

  constructor(channel: Channel) {
    this._channel = channel;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bind(eventName: string, handler: (data: any) => void): this {
    const wrapped = (data: unknown) => {
      markPusherEvent(eventName);
      handler(data);
    };
    this._wrappers.set(handler, wrapped);
    this._channel.bind(eventName, wrapped);
    return this;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  unbind(eventName: string, handler?: (data: any) => void): this {
    if (handler) {
      const wrapped = this._wrappers.get(handler) ?? handler;
      this._channel.unbind(eventName, wrapped);
      this._wrappers.delete(handler);
    } else {
      this._channel.unbind(eventName);
    }
    return this;
  }
}

// ── Lazy Pusher constructor ────────────────────────────────────────────────────
// The RN bundle exports { __esModule: true, Pusher: class },
// the browser bundle exports a default. Handle both.
function getPusherClass(): PusherClass {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
  const mod: any = require("pusher-js");
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
  return (mod.Pusher ?? mod.default ?? mod) as PusherClass;
}

// ── Client init ────────────────────────────────────────────────────────────────
function getClient(): PusherInstance | null {
  if (!PUSHER_KEY) return null;
  if (_client) return _client;

  const PusherCtor = getPusherClass();
  _client = new PusherCtor(PUSHER_KEY, {
    cluster: PUSHER_CLUSTER,
    forceTLS: true,
    authorizer: (channel) => ({
      authorize: async (socketId, callback) => {
        try {
          const { session } = await getStoredSession();
          if (!session) {
            callback(new Error("No auth session for Pusher"), { auth: "" });
            return;
          }
          const resp = await fetch(`${API_BASE}/api/realtime/pusher/auth`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session}`,
            },
            body: JSON.stringify({
              socket_id: socketId,
              channel_name: channel.name,
            }),
          });
          if (!resp.ok) {
            callback(new Error(`Pusher auth failed: ${resp.status}`), { auth: "" });
            return;
          }
          const data = await resp.json();
          callback(null, data as { auth: string });
        } catch (err) {
          callback(err instanceof Error ? err : new Error(String(err)), { auth: "" });
        }
      },
    }),
  });

  _client.connection.bind("connected", () => {
    markPusherConnected(true);
    perf.pusherConnected(true);
  });
  _client.connection.bind("disconnected", () => {
    markPusherConnected(false);
    perf.pusherConnected(false);
  });
  _client.connection.bind("unavailable", () => {
    markPusherConnected(false);
    perf.pusherConnected(false);
  });

  return _client;
}

/** Call after login — no-op if Pusher is not configured */
export function connectPusher(): void {
  getClient(); // triggers lazy init + auto-connects
}

export function disconnectPusher(): void {
  if (!_client) return;
  _client.disconnect();
  _client = null;
}

export function getPusherClient(): PusherInstance | null {
  return getClient();
}

// ── Channel helpers ────────────────────────────────────────────────────────────
export function subscribeToChannel(channelName: string): ChannelAdapter | null {
  const client = getClient();
  if (!client) return null;
  const channel = client.subscribe(channelName);
  return new ChannelAdapter(channel);
}

export function unsubscribeFromChannel(channelName: string): void {
  _client?.unsubscribe(channelName);
}

export function unsubscribeAll(): void {
  if (!_client) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channels = Object.keys((_client as any).channels?.channels ?? {});
  for (const ch of channels) {
    _client.unsubscribe(ch);
  }
}

// ── Well-known channel names ──────────────────────────────────────────────────
export const CHANNELS = {
  GLOBAL_CHAT: "public-global-chat",
  PRESENCE: "public-presence",
  LIVE_LEADERBOARD: "public-leaderboard-global",
  liveRace: (raceId: string) => `public-live-race-${raceId}`,
  privateUser: (userId: string) => `private-user-${userId}`,
  privateChat: (convId: string) => `private-chat-${convId}`,
  presenceRace: (raceId: string) => `presence-race-${raceId}`,
};

// ── Event names ───────────────────────────────────────────────────────────────
export const EVENTS = {
  CHAT_NEW_MESSAGE: "chat:new_message",
  RACE_JOINED: "race:joined",
  RACE_STARTED: "race:started",
  RACE_PROGRESS: "race:progress_updated",
  RACE_COMMENT: "race:comment_added",
  RACE_REACTION: "race:reaction_added",
  RACE_COMPLETED: "race:completed",
  LEADERBOARD_UPDATED: "leaderboard:updated",
  WALLET_UPDATED: "wallet:updated",
  PRESENCE_UPDATED: "presence:summary_updated",
  FRIEND_REQUEST_NEW: "friend_request:new",
  FRIEND_REQUEST_SENT: "friend_request:sent",
  FRIEND_REQUEST_ACCEPTED: "friend_request:accepted",
  FRIEND_REQUEST_REJECTED: "friend_request:rejected",
  FRIEND_LIST_UPDATED: "friend:list_updated",
  AVATAR_UPDATED: "avatar:updated",
  COINS_EARNED: "coins:earned",
  ROOM_INVITE_NEW: "room_invite:new",
  ROOM_INVITE_EXPIRED: "room_invite:expired",
  ROOM_INVITE_ACCEPTED: "room_invite:accepted",
  ROOM_INVITE_DECLINED: "room_invite:declined",
  GROUP_INVITE_NEW: "group.invite.sent",
  SPONSORED_EVENT_REGISTRATION_UPDATED: "sponsored_event.registration_updated",
  SPONSORED_EVENT_STARTED: "sponsored_event.started",
  SPONSORED_EVENT_CANCELLED: "sponsored_event.cancelled",
  SPONSORED_EVENT_CREATED: "sponsored_event.created",
  SPONSORED_EVENT_COMPLETED: "sponsored_event.completed",
};

export const SPONSORED_EVENTS_CHANNEL = "public-sponsored-events";
