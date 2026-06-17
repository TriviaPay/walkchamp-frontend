import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";

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
      const res = await authFetch("/api/chat/summary");
      if (!res.ok) return;
      const data: { privateUnread: number; requestCount: number } = await res.json();
      setPrivateUnread(data.privateUnread ?? 0);
      setPendingRequests(data.requestCount ?? 0);
    } catch { /* silent */ } finally {
      fetchingRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void fetchSummary();
    });
    return () => sub.remove();
  }, [fetchSummary]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = subscribeToChannel(CHANNELS.privateUser(user.id));
    if (!channel) return;

    const onNewRequest = () => setPendingRequests((n) => n + 1);
    const onAccepted = () => void fetchSummary();
    const onPrivateMsg = (data: { isPrivate?: boolean }) => {
      if (data.isPrivate) setPrivateUnread((n) => n + 1);
    };
    const onGroupInvite = () => setPendingGroupInvites((n) => n + 1);

    channel.bind(EVENTS.FRIEND_REQUEST_NEW, onNewRequest);
    channel.bind(EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
    channel.bind(EVENTS.CHAT_NEW_MESSAGE, onPrivateMsg);
    channel.bind(EVENTS.GROUP_INVITE_NEW, onGroupInvite);

    return () => {
      channel.unbind(EVENTS.FRIEND_REQUEST_NEW, onNewRequest);
      channel.unbind(EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
      channel.unbind(EVENTS.CHAT_NEW_MESSAGE, onPrivateMsg);
      channel.unbind(EVENTS.GROUP_INVITE_NEW, onGroupInvite);
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

  return (
    <UnreadContext.Provider
      value={{
        privateUnread,
        pendingRequests,
        pendingGroupInvites,
        totalUnread: privateUnread + pendingRequests,
        refresh: fetchSummary,
        markRequestsSeen,
        clearPrivateUnread,
        clearGroupInvites,
      }}
    >
      {children}
    </UnreadContext.Provider>
  );
}

export function useUnread(): UnreadContextValue {
  return useContext(UnreadContext);
}
