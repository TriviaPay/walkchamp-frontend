/**
 * Centralized coalesced reads for hot endpoints.
 * Preserves existing authFetch behavior / response shapes.
 */

import { authFetch } from "@/utils/authFetch";
import { runCoalesced } from "@/utils/apiRequestCoordinator";

export async function fetchProfileMe<T = unknown>(options?: {
  coalesceKey?: string;
}): Promise<{ ok: boolean; status: number; data: T | null }> {
  const key = options?.coalesceKey ?? "GET:/api/profile/me";
  return runCoalesced(key, async () => {
    const res = await authFetch("/api/profile/me");
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  });
}

export async function fetchChatSummary<T = unknown>(): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
}> {
  return runCoalesced("GET:/api/chat/summary", async () => {
    const res = await authFetch("/api/chat/summary");
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  });
}

export async function fetchLeaderboard<T = unknown>(query = ""): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
}> {
  const path = query ? `/api/leaderboard?${query}` : "/api/leaderboard";
  return runCoalesced(`GET:${path}`, async () => {
    const res = await authFetch(path);
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  });
}

export async function fetchSponsoredEvents<T = unknown>(query = ""): Promise<{
  ok: boolean;
  status: number;
  data: T | null;
}> {
  const path = query ? `/api/sponsored-events?${query}` : "/api/sponsored-events";
  return runCoalesced(`GET:${path}`, async () => {
    const res = await authFetch(path);
    let data: T | null = null;
    try {
      data = (await res.json()) as T;
    } catch {
      data = null;
    }
    return { ok: res.ok, status: res.status, data };
  });
}
