/**
 * Subscribes to private-user + private-session session-invalidated Pusher events.
 * Backend remains the security authority; this is UX immediacy only.
 *
 * Rules (prevent first-login self-kick):
 * - Ignore events while login grace is active
 * - Ignore when local session meta is not registered yet
 * - On private-user: only act when payload.sessionId === our sessionId
 * - On private-session: event is already scoped to our session
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
import {
  handleSessionInvalidation,
  isSessionLoginGraceActive,
} from "@/services/sessionInvalidation";

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

    const handleKick = async (
      data: unknown,
      source: "user" | "session",
    ) => {
      const payload = (data ?? {}) as {
        type?: string;
        reason?: string;
        sessionId?: string;
        message?: string;
      };
      if (__DEV__) {
        console.log(
          `[AuthSession] pusher session-invalidated received source=${source}`,
        );
      }

      if (isSessionLoginGraceActive()) {
        if (__DEV__) {
          console.log("[AuthSession] pusher ignored — login grace active");
        }
        return;
      }

      const local = await getActiveSessionMeta();
      if (!local?.sessionId) {
        if (__DEV__) {
          console.log("[AuthSession] pusher ignored — no local session yet");
        }
        return;
      }

      if (source === "user") {
        // Broadcast on private-user: only kick if the payload names OUR session.
        if (!payload.sessionId || payload.sessionId !== local.sessionId) {
          if (__DEV__) {
            console.log(
              "[AuthSession] pusher user-channel ignored — not our sessionId",
            );
          }
          return;
        }
      } else if (payload.sessionId && payload.sessionId !== local.sessionId) {
        return;
      }

      await handleSessionInvalidation({
        reason: payload.reason ?? "login_on_new_device",
        sessionId: payload.sessionId ?? local.sessionId,
        message:
          payload.message ??
          "Your account was signed in on another device. Please sign in again.",
      });
    };

    const userHandler = (data: unknown) => {
      void handleKick(data, "user");
    };
    const sessionHandler = (data: unknown) => {
      void handleKick(data, "session");
    };

    const bindChannel = (
      name: string,
      handler: (data: unknown) => void,
    ): ChannelAdapter | null => {
      if (boundNamesRef.current.includes(name)) return null;
      const channel = subscribeToChannel(name);
      if (!channel) return null;
      boundNamesRef.current.push(name);
      channel.bind(EVENTS.SESSION_INVALIDATED, handler);
      channel.bind("session_invalidated", handler);
      return channel;
    };

    userChannelRef.current = bindChannel(
      CHANNELS.privateUser(userId),
      userHandler,
    );

    const tryBindSessionChannel = async () => {
      for (let i = 0; i < 12 && !cancelled; i++) {
        if (isSessionLoginGraceActive() && i < 2) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        const meta = await getActiveSessionMeta().catch(() => null);
        if (meta?.sessionId) {
          sessionChannelRef.current = bindChannel(
            CHANNELS.privateSession(meta.sessionId),
            sessionHandler,
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
          const isSession = name.startsWith("private-session-");
          const ch = isSession
            ? sessionChannelRef.current
            : userChannelRef.current;
          const handler = isSession ? sessionHandler : userHandler;
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
