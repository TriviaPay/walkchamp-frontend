/**
 * Subscribes to private-user + private-session session-invalidated Pusher events.
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
  const userChannelRef = useRef<ChannelAdapter | null>(null);
  const sessionChannelRef = useRef<ChannelAdapter | null>(null);
  const boundNamesRef = useRef<string[]>([]);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    boundNamesRef.current = [];

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

    const bindChannel = (name: string): ChannelAdapter | null => {
      if (boundNamesRef.current.includes(name)) return null;
      const channel = subscribeToChannel(name);
      if (!channel) return null;
      boundNamesRef.current.push(name);
      channel.bind(EVENTS.SESSION_INVALIDATED, handler);
      channel.bind("session_invalidated", handler);
      return channel;
    };

    userChannelRef.current = bindChannel(CHANNELS.privateUser(userId));

    // Session channel needs X-Session-Id on pusher auth — wait briefly for register().
    const tryBindSessionChannel = async () => {
      for (let i = 0; i < 8 && !cancelled; i++) {
        const meta = await getActiveSessionMeta().catch(() => null);
        if (meta?.sessionId) {
          sessionChannelRef.current = bindChannel(
            CHANNELS.privateSession(meta.sessionId),
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    };
    void tryBindSessionChannel();

    return () => {
      cancelled = true;
      const names = [...boundNamesRef.current];
      boundNamesRef.current = [];
      for (const name of names) {
        try {
          const ch = name.startsWith("private-session-")
            ? sessionChannelRef.current
            : userChannelRef.current;
          ch?.unbind(EVENTS.SESSION_INVALIDATED, handler);
          ch?.unbind("session_invalidated", handler);
        } catch {
          /* ignore */
        }
        unsubscribeFromChannel(name);
      }
      userChannelRef.current = null;
      sessionChannelRef.current = null;
    };
  }, [userId]);

  return null;
}
