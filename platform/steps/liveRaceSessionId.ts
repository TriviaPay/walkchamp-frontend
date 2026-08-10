/**
 * Stable live-race tracking session ids (≤64 chars).
 * Regenerate on race activation, reboot/sensor re-anchor, or explicit rotate.
 */

const SESSION_MAX = 64;

/** Short, opaque session id suitable for POST /progress sessionId. */
export function mintLiveRaceSessionId(parts?: {
  userId?: string | null;
  raceId?: string | null;
  reason?: string;
}): string {
  const u = (parts?.userId ?? "u").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const r = (parts?.raceId ?? "r").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8);
  const t = Date.now().toString(36);
  const n = Math.random().toString(36).slice(2, 8);
  const tag = (parts?.reason ?? "s").replace(/[^a-zA-Z0-9]/g, "").slice(0, 4);
  return `s${u}${r}${t}${n}${tag}`.slice(0, SESSION_MAX);
}

export function clampRaceSessionId(id: string | null | undefined): string | undefined {
  if (!id) return undefined;
  const trimmed = String(id).trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, SESSION_MAX);
}
