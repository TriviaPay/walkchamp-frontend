import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { getValidSession } from "@/services/authService";
import { timeoutSignal, PRESENCE_TIMEOUT } from "@/utils/authFetch";
import { connectPusher, subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";

export type UserStatus = "online" | "walking" | "racing" | "spectating" | "away" | "offline";

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
}

const PresenceContext = createContext<PresenceContextType | null>(null);

const HEARTBEAT_INTERVAL_MS = 30_000;
const EMPTY_COUNTS: PresenceCounts = { online: 0, walking: 0, racing: 0, spectating: 0 };

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

async function fetchPresenceSummary(): Promise<PresenceCounts | null> {
  const session = await getValidSession();
  if (!session) return null;
  try {
    const res = await fetch(`${API_BASE}/api/presence/summary`, {
      signal: timeoutSignal(PRESENCE_TIMEOUT),
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.counts ?? null;
  } catch {
    return null;
  }
}

async function sendHeartbeat(status: UserStatus): Promise<void> {
  const session = await getValidSession();
  if (!session) return;
  try {
    await fetch(`${API_BASE}/api/presence/heartbeat`, {
      method: "POST",
      signal: timeoutSignal(PRESENCE_TIMEOUT),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
      body: JSON.stringify({ status }),
    });
  } catch {
    // best-effort — heartbeat failures are non-fatal
  }
}

async function sendOffline(): Promise<void> {
  const session = await getValidSession();
  if (!session) return;
  try {
    await fetch(`${API_BASE}/api/presence/offline`, {
      method: "POST",
      signal: timeoutSignal(PRESENCE_TIMEOUT),
      headers: { Authorization: `Bearer ${session}` },
    });
  } catch {}
}

export function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toString();
}

export function PresenceProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<PresenceCounts>(EMPTY_COUNTS);
  const [userStatus, setUserStatusState] = useState<UserStatus>("online");
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const setUserStatus = useCallback((status: UserStatus) => {
    setUserStatusState(status);
    sendHeartbeat(status).catch(() => {});
  }, []);

  // Initial load
  useEffect(() => {
    fetchPresenceSummary().then((c) => {
      if (c) setCounts(c);
    });
  }, []);

  // Heartbeat loop
  useEffect(() => {
    sendHeartbeat(userStatus).catch(() => {});
    heartbeatRef.current = setInterval(() => {
      sendHeartbeat(userStatus).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [userStatus]);

  // App background/foreground lifecycle
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;
      if (next === "background" || next === "inactive") {
        sendOffline().catch(() => {});
        if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      } else if (next === "active" && prev !== "active") {
        sendHeartbeat(userStatus).catch(() => {});
        heartbeatRef.current = setInterval(() => {
          sendHeartbeat(userStatus).catch(() => {});
        }, HEARTBEAT_INTERVAL_MS);
        fetchPresenceSummary().then((c) => { if (c) setCounts(c); });
      }
    });
    return () => sub.remove();
  }, [userStatus]);

  // Pusher real-time presence updates
  useEffect(() => {
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;

    channel.bind(EVENTS.PRESENCE_UPDATED, (data: { counts: PresenceCounts }) => {
      if (data?.counts) setCounts(data.counts);
    });

    return () => {
      channel.unbind(EVENTS.PRESENCE_UPDATED);
    };
  }, []);

  return (
    <PresenceContext.Provider value={{ counts, userStatus, setUserStatus, formatCount }}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextType {
  const ctx = useContext(PresenceContext);
  if (!ctx) throw new Error("usePresence must be used within PresenceProvider");
  return ctx;
}
