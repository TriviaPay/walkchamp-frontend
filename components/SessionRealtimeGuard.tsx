/**
 * Subscribes to private-user session-invalidated Pusher events.
 * Backend remains the security authority; this is UX immediacy only.
 */

import { useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  CHANNELS,
  EVENTS,
  subscribeToChannel,
  unsubscribeFromChannel,
  ChannelAdapter,
} from "@/services/realtimeService";
import { getActiveSessionMeta } from "@/services/authSessionMetadata";
import { handleSessionInvalidation } from "@/services/sessionInvalidation";

export function SessionRealtimeGuard() {
  const { user } = useAuth();
  const channelRef = useRef<ChannelAdapter | null>(null);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    const channelName = CHANNELS.privateUser(userId);
    const channel = subscribeToChannel(channelName);
    channelRef.current = channel;
    if (!channel) return;

    const handler = async (data: unknown) => {
      const payload = (data ?? {}) as {
        type?: string;
        reason?: string;
        sessionId?: string;
        message?: string;
      };
      if (__DEV__) {
        console.log("[AuthSession] pusher session-invalidated received");
      }
      const local = await getActiveSessionMeta();
      if (payload.sessionId && local?.sessionId && payload.sessionId !== local.sessionId) {
        if (__DEV__) {
          console.log("[AuthSession] pusher event ignored — not our session");
        }
        return;
      }
      await handleSessionInvalidation({
        reason: payload.reason ?? "login_on_new_device",
        sessionId: payload.sessionId,
        message:
          payload.message ??
          "Your account was signed in on another device. Please sign in again.",
      });
    };

    channel.bind(EVENTS.SESSION_INVALIDATED, handler);
    channel.bind("session_invalidated", handler);

    return () => {
      try {
        channel.unbind(EVENTS.SESSION_INVALIDATED, handler);
        channel.unbind("session_invalidated", handler);
      } catch {
        /* ignore */
      }
      unsubscribeFromChannel(channelName);
      channelRef.current = null;
    };
  }, [userId]);

  return null;
}
