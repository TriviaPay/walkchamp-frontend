/**
 * Shared helpers for /api/presence/online-ids payloads and ID matching.
 */

export function normalizeUserId(id: unknown): string {
  if (id == null) return "";
  return String(id).trim().toLowerCase();
}

/** Pull user IDs from strings/numbers or `{ userId | id }` objects. */
export function coerceIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (item == null) continue;
    if (typeof item === "string" || typeof item === "number") {
      const id = normalizeUserId(item);
      if (id) out.push(id);
      continue;
    }
    if (typeof item === "object") {
      const rec = item as Record<string, unknown>;
      const id = normalizeUserId(
        rec.userId ?? rec.user_id ?? rec.id ?? rec.uid,
      );
      if (id) out.push(id);
    }
  }
  return out;
}

export function toOnlineIdSet(ids: unknown[] | undefined | null): Set<string> {
  return new Set(coerceIdList(ids));
}

/** Accept common `/api/presence/online-ids` response shapes. */
export function extractOnlineIdsFromPayload(data: unknown): string[] {
  if (data == null) return [];
  if (Array.isArray(data)) return coerceIdList(data);
  if (typeof data !== "object") return [];
  const obj = data as Record<string, unknown>;
  const nested =
    (obj.data && typeof obj.data === "object"
      ? (obj.data as Record<string, unknown>)
      : null) ?? null;
  const candidates = [
    obj.userIds,
    obj.onlineUserIds,
    obj.online_ids,
    obj.onlineUsers,
    obj.online_users,
    obj.users,
    obj.ids,
    obj.online,
    nested?.userIds,
    nested?.onlineUserIds,
    nested?.online_ids,
    nested?.onlineUsers,
    nested?.users,
    nested?.ids,
    nested?.online,
  ];
  for (const c of candidates) {
    const ids = coerceIdList(c);
    if (ids.length > 0) return ids;
  }
  return [];
}
