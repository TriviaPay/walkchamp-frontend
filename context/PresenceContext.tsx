import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { authFetch, PRESENCE_TIMEOUT } from "@/utils/authFetch";
import { useAuth } from "@/context/AuthContext";
import {
  connectPusher,
  subscribeToChannel,
  unsubscribeFromChannel,
  CHANNELS,
  EVENTS,
} from "@/services/realtimeService";
import { markPusherConnected, markPusherEvent } from "@/services/pusherHealth";
import {
  extractOnlineIdsFromPayload,
  normalizeUserId,
  toOnlineIdSet,
} from "@/utils/presenceIds";
import { waitForAppStartupReady } from "@/services/appStartup";
import { perf } from "@/utils/perfLogger";

export type UserStatus =
  | "online"
  | "walking"
  | "racing"
  | "spectating"
  | "away"
  | "offline";

interface PresenceCounts {
  online: number;
  walking: number;
  racing: number;
  spectating: number;
}

interface PresenceContextType {
  counts: PresenceCounts;
  userStatus: UserStatus;
  setUserStatus: (status: UserStatus) => void;
  formatCount: (n: number) => string;
  /** Normalized user IDs currently online (shared across Chat, Waiting Room, etc.). */
  onlineUserIds: Set<string>;
  /** Case-insensitive online check used by every screen. */
  isUserOnline: (userId: unknown) => boolean;
  refreshOnlineIds: () => Promise<void>;
}

const PresenceContext = createContext<PresenceContextType | null>(null);

const HEARTBEAT_INTERVAL_MS = 30_000;
const ONLINE_IDS_POLL_MS = 8_000;
const EMPTY_COUNTS: PresenceCounts = {
  online: 0,
  walking: 0,
  racing: 0,
  spectating: 0,
};

type PresenceCountsSlice = Pick<PresenceContextType, "counts" | "formatCount">;
const PresenceCountsContext = createContext<PresenceCountsSlice | null>(null);

type PresenceOnlineSlice = Pick<
  PresenceContextType,
  "onlineUserIds" | "isUserOnline" | "refreshOnlineIds" | "setUserStatus" | "userStatus"
>;
const PresenceOnlineContext = createContext<PresenceOnlineSlice | null>(null);

async function fetchPresenceSummary(): Promise<PresenceCounts | null> {
  try {
    const res = await authFetch("/api/presence/summary", {
      timeoutMs: PRESENCE_TIMEOUT,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.counts ?? null;
  } catch {
    return null;
  }
}

async function sendHeartbeat(status: UserStatus): Promise<void> {
  try {
    await authFetch("/api/presence/heartbeat", {
      method: "POST",
      timeoutMs: PRESENCE_TIMEOUT,
      body: JSON.stringify({ status }),
    });
  } catch {
    // best-effort — heartbeat failures are non-fatal
  }
}

async function sendOffline(): Promise<void> {
  try {
    await authFetch("/api/presence/offline", {
      method: "POST",
      timeoutMs: PRESENCE_TIMEOUT,
    });
  } catch {}
}

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const { user, sessionToken } = useAuth();
  const isSignedIn = !!user?.id && !!sessionToken;
  const selfId = normalizeUserId(user?.id);
  const [counts, setCounts] = useState<PresenceCounts>(EMPTY_COUNTS);
  const [userStatus, setUserStatusState] = useState<UserStatus>("online");
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const clearHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const refreshOnlineIds = useCallback(async () => {
    if (!isSignedIn) {
      setOnlineUserIds(new Set());
      return;
    }
    const next = new Set<string>();
    if (selfId) next.add(selfId);

    try {
      const [friendsOnlineSettled, legacySettled, friendsSettled] =
        await Promise.allSettled([
          authFetch("/api/presence/friends/online", {
            timeoutMs: PRESENCE_TIMEOUT,
          }),
          authFetch("/api/presence/online-ids", {
            timeoutMs: PRESENCE_TIMEOUT,
          }),
          authFetch("/api/friends", {
            timeoutMs: PRESENCE_TIMEOUT,
          }),
        ]);

      if (
        friendsOnlineSettled.status === "fulfilled" &&
        friendsOnlineSettled.value.ok
      ) {
        const data: unknown = await friendsOnlineSettled.value.json();
        for (const id of extractOnlineIdsFromPayload(data)) {
          const n = normalizeUserId(id);
          if (n) next.add(n);
        }
      }

      if (legacySettled.status === "fulfilled" && legacySettled.value.ok) {
        const data: unknown = await legacySettled.value.json();
        for (const id of extractOnlineIdsFromPayload(data)) {
          const n = normalizeUserId(id);
          if (n) next.add(n);
        }
      }

      if (friendsSettled.status === "fulfilled" && friendsSettled.value.ok) {
        const friendsData = (await friendsSettled.value.json()) as {
          friends?: { id?: string; userId?: string; isOnline?: boolean }[];
        };
        for (const f of friendsData.friends ?? []) {
          if (!f.isOnline) continue;
          const id = normalizeUserId(f.userId ?? f.id);
          if (id) next.add(id);
        }
      }
    } catch {
      // optional enrichment
    }

    setOnlineUserIds((prev) => {
      if (prev.size === next.size) {
        let same = true;
        for (const id of next) {
          if (!prev.has(id)) {
            same = false;
            break;
          }
        }
        if (same) {
          if (__DEV__) perf.presenceSkippedUnchanged();
          return prev;
        }
      }
      return next;
    });
  }, [isSignedIn, selfId]);

  const isUserOnline = useCallback(
    (userId: unknown) => {
      const id = normalizeUserId(userId);
      if (!id) return false;
      if (selfId && id === selfId) return true;
      return onlineUserIds.has(id);
    },
    [onlineUserIds, selfId],
  );

  const setUserStatus = useCallback(
    (status: UserStatus) => {
      setUserStatusState(status);
      if (!isSignedIn) return;
      sendHeartbeat(status).catch(() => {});
    },
    [isSignedIn],
  );

  // Gate presence network/realtime until after cold-start (reduces splash hitch).
  const [startupReady, setStartupReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void waitForAppStartupReady().then(() => {
      if (!cancelled) setStartupReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Initial summary + online ids
  useEffect(() => {
    if (!isSignedIn) {
      setCounts(EMPTY_COUNTS);
      setOnlineUserIds(new Set());
      return;
    }
    if (!startupReady) return;
    fetchPresenceSummary().then((c) => {
      if (c) setCounts(c);
    });
    void refreshOnlineIds();
  }, [isSignedIn, refreshOnlineIds, startupReady]);

  // Heartbeat — only while authenticated and past startup gate
  useEffect(() => {
    clearHeartbeat();
    if (!isSignedIn || !startupReady) return;
    sendHeartbeat(userStatus).catch(() => {});
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat(userStatus).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      clearHeartbeat();
    };
  }, [userStatus, isSignedIn, clearHeartbeat, startupReady]);

  // Poll online IDs so Chat / Waiting Room / profiles stay in sync
  useEffect(() => {
    if (!isSignedIn || !startupReady) return;
    const id = setInterval(() => {
      void refreshOnlineIds();
    }, ONLINE_IDS_POLL_MS);
    return () => clearInterval(id);
  }, [isSignedIn, refreshOnlineIds, startupReady]);

  // App lifecycle — mark offline only on true background (not inactive).
  // inactive fires for Control Center / brief overlays and was wiping presence.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (!isSignedIn || !startupReady) return;
      if (next === "background") {
        sendOffline().catch(() => {});
        clearHeartbeat();
      } else if (next === "active" && prev !== "active") {
        sendHeartbeat(userStatus).catch(() => {});
        clearHeartbeat();
        heartbeatRef.current = setInterval(() => {
          sendHeartbeat(userStatus).catch(() => {});
        }, HEARTBEAT_INTERVAL_MS);
        fetchPresenceSummary().then((c) => {
          if (c) setCounts(c);
        });
        void refreshOnlineIds();
      }
    });
    return () => sub.remove();
  }, [userStatus, isSignedIn, clearHeartbeat, refreshOnlineIds, startupReady]);

  // Pusher real-time presence updates — only while signed in.
  useEffect(() => {
    if (!isSignedIn || !startupReady) return;
    connectPusher();
    markPusherConnected(true);
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;

    channel.bind(EVENTS.PRESENCE_UPDATED, (data: { counts: PresenceCounts }) => {
      markPusherEvent("presence");
      if (data?.counts) setCounts(data.counts);
      void refreshOnlineIds();
    });

    return () => {
      channel.unbind(EVENTS.PRESENCE_UPDATED);
      unsubscribeFromChannel(CHANNELS.PRESENCE);
    };
  }, [isSignedIn, refreshOnlineIds, startupReady]);

  const countsValue = useMemo(
    () => ({ counts, formatCount }),
    [counts],
  );
  const onlineValue = useMemo(
    () => ({
      onlineUserIds,
      isUserOnline,
      refreshOnlineIds,
      setUserStatus,
      userStatus,
    }),
    [onlineUserIds, isUserOnline, refreshOnlineIds, setUserStatus, userStatus],
  );
  const value = useMemo(
    () => ({
      counts,
      userStatus,
      setUserStatus,
      formatCount,
      onlineUserIds,
      isUserOnline,
      refreshOnlineIds,
    }),
    [
      counts,
      userStatus,
      setUserStatus,
      onlineUserIds,
      isUserOnline,
      refreshOnlineIds,
    ],
  );

  return (
    <PresenceContext.Provider value={value}>
      <PresenceCountsContext.Provider value={countsValue}>
        <PresenceOnlineContext.Provider value={onlineValue}>
          {children}
        </PresenceOnlineContext.Provider>
      </PresenceCountsContext.Provider>
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextType {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within PresenceProvider");
  return ctx;
}

/** Counts + formatter only — does not re-render when onlineUserIds Set changes. */
export function usePresenceCounts(): PresenceCountsSlice {
  const ctx = useContext(PresenceCountsContext);
  if (!ctx) throw new Error("usePresenceCounts must be used within PresenceProvider");
  return ctx;
}

/** Online checks / status actions — isolated from aggregate count updates. */
export function usePresenceActions(): PresenceOnlineSlice {
  const ctx = useContext(PresenceOnlineContext);
  if (!ctx) throw new Error("usePresenceActions must be used within PresenceProvider");
  return ctx;
}
