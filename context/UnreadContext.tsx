import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { fetchChatSummary } from "@/services/api/hotReads";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import {
  subscribeToChannel,
  unsubscribeFromChannel,
  CHANNELS,
  EVENTS,
} from "@/services/realtimeService";
import { waitForAppStartupReady } from "@/services/appStartup";

interface UnreadContextValue {
  privateUnread: number;
  pendingRequests: number;
  pendingGroupInvites: number;
  totalUnread: number;
  refresh: () => Promise<void>;
  markRequestsSeen: () => Promise<void>;
  clearPrivateUnread: () => void;
  clearGroupInvites: () => void;
}

const UnreadContext = createContext<UnreadContextValue>({
  privateUnread: 0,
  pendingRequests: 0,
  pendingGroupInvites: 0,
  totalUnread: 0,
  refresh: async () => {},
  markRequestsSeen: async () => {},
  clearPrivateUnread: () => {},
  clearGroupInvites: () => {},
});

export function UnreadProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [privateUnread, setPrivateUnread] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [pendingGroupInvites, setPendingGroupInvites] = useState(0);
  const fetchingRef = useRef(false);

  const fetchSummary = useCallback(async () => {
    if (!user?.id) return;
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const { ok, data } = await fetchChatSummary<{
        privateUnread: number;
        requestCount: number;
      }>();
      if (!ok || !data) return;
      setPrivateUnread(data.privateUnread ?? 0);
      setPendingRequests(data.requestCount ?? 0);
    } catch { /* silent — preserve prior badge values */ } finally {
      fetchingRef.current = false;
    }
  }, [user?.id]);

  // Defer unread network/realtime until after cold-start gate (reduces splash hitch).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void waitForAppStartupReady().then(() => {
      if (!cancelled) void fetchSummary();
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSummary, user?.id]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      // Pusher keeps the unread badge live while the app is open, so only
      // reconcile via the summary endpoint when the last fetch is stale.
      if (state === "active" && apiFetchAllowed("unread_summary_resume", 30_000)) {
        markApiFetched("unread_summary_resume");
        void fetchSummary();
      }
    });
    return () => sub.remove();
  }, [fetchSummary]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    let channelName: string | null = null;
    let channel: ReturnType<typeof subscribeToChannel> = null;

    const onNewRequest = () => setPendingRequests((n) => n + 1);
    const onAccepted = () => void fetchSummary();
    const onRejected = () => setPendingRequests((n) => Math.max(0, n - 1));
    const onPrivateMsg = (data: { isPrivate?: boolean }) => {
      if (data.isPrivate) setPrivateUnread((n) => n + 1);
    };
    const onGroupInvite = () => setPendingGroupInvites((n) => n + 1);

    void waitForAppStartupReady().then(() => {
      if (cancelled || !user?.id) return;
      channelName = CHANNELS.privateUser(user.id);
      channel = subscribeToChannel(channelName);
      if (!channel) return;
      channel.bind(EVENTS.FRIEND_REQUEST_NEW, onNewRequest);
      channel.bind(EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
      channel.bind(EVENTS.FRIEND_REQUEST_REJECTED, onRejected);
      channel.bind(EVENTS.CHAT_NEW_MESSAGE, onPrivateMsg);
      channel.bind(EVENTS.GROUP_INVITE_NEW, onGroupInvite);
    });

    return () => {
      cancelled = true;
      if (channel) {
        channel.unbind(EVENTS.FRIEND_REQUEST_NEW, onNewRequest);
        channel.unbind(EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
        channel.unbind(EVENTS.FRIEND_REQUEST_REJECTED, onRejected);
        channel.unbind(EVENTS.CHAT_NEW_MESSAGE, onPrivateMsg);
        channel.unbind(EVENTS.GROUP_INVITE_NEW, onGroupInvite);
      }
      if (channelName) unsubscribeFromChannel(channelName);
    };
  }, [user?.id, fetchSummary]);

  const markRequestsSeen = useCallback(async () => {
    setPendingRequests(0);
    try {
      await authFetch("/api/friends/requests/mark-seen", { method: "POST" });
    } catch { /* silent */ }
  }, []);

  const clearPrivateUnread = useCallback(() => {
    setPrivateUnread(0);
  }, []);

  const clearGroupInvites = useCallback(() => {
    setPendingGroupInvites(0);
  }, []);

  const value = useMemo(
    () => ({
      privateUnread,
      pendingRequests,
      pendingGroupInvites,
      totalUnread: privateUnread + pendingRequests,
      refresh: fetchSummary,
      markRequestsSeen,
      clearPrivateUnread,
      clearGroupInvites,
    }),
    [
      privateUnread,
      pendingRequests,
      pendingGroupInvites,
      fetchSummary,
      markRequestsSeen,
      clearPrivateUnread,
      clearGroupInvites,
    ],
  );

  return (
    <UnreadContext.Provider value={value}>
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread(): UnreadContextValue {
  return useContext(UnreadContext);
}
