/**
 * UI bus for session notices — prefers a Modal over Alert.alert.
 */

import type { SessionInvalidationPayload, SessionInvalidationReason } from "@/services/sessionInvalidation";
import type { SessionNoticeKind } from "@/components/SessionReplacedModal";

export type SessionNoticeState = {
  visible: boolean;
  kind: SessionNoticeKind;
  message: string | null;
};

type Listener = (state: SessionNoticeState) => void;

const listeners = new Set<Listener>();
let current: SessionNoticeState = {
  visible: false,
  kind: "replaced",
  message: null,
};
let lastShownAt = 0;
const COOLDOWN_MS = 8_000;

function kindFromReason(reason: SessionInvalidationReason): SessionNoticeKind {
  const r = String(reason).toUpperCase();
  if (
    r === "SESSION_REPLACED" ||
    r === "LOGIN_ON_NEW_DEVICE" ||
    r.includes("REPLAC") ||
    r.includes("INVALIDATED")
  ) {
    return "replaced";
  }
  if (r === "SESSION_REVOKED" || r.includes("REVOK")) return "revoked";
  return "expired";
}

export function getSessionNoticeState(): SessionNoticeState {
  return current;
}

export function onSessionNotice(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function showSessionNotice(payload: SessionInvalidationPayload): void {
  const now = Date.now();
  if (now - lastShownAt < COOLDOWN_MS && current.visible) return;
  lastShownAt = now;
  current = {
    visible: true,
    kind: kindFromReason(payload.reason),
    message: payload.message?.trim() || null,
  };
  listeners.forEach((cb) => {
    try {
      cb(current);
    } catch {
      /* ignore */
    }
  });
}

export function dismissSessionNotice(): void {
  current = { ...current, visible: false };
  listeners.forEach((cb) => {
    try {
      cb(current);
    } catch {
      /* ignore */
    }
  });
}
