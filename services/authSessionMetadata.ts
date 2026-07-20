/**
 * Active session metadata (SecureStore). Cleared on logout / session replacement.
 * Installation ID is NOT cleared here.
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_ID_KEY = "wc_active_session_id_v1";
const SESSION_GEN_KEY = "wc_active_session_gen_v1";
const SESSION_USER_KEY = "wc_active_session_user_v1";
const SESSION_CREATED_KEY = "wc_active_session_created_v1";

export type ActiveSessionMeta = {
  sessionId: string;
  sessionGeneration?: string;
  userId: string;
  createdAt?: string;
};

let memoryMeta: ActiveSessionMeta | null = null;

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
}

async function secureDelete(key: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    /* ignore */
  }
}

export async function saveActiveSessionMeta(meta: ActiveSessionMeta): Promise<void> {
  memoryMeta = meta;
  await Promise.all([
    secureSet(SESSION_ID_KEY, meta.sessionId),
    meta.sessionGeneration
      ? secureSet(SESSION_GEN_KEY, meta.sessionGeneration)
      : secureDelete(SESSION_GEN_KEY),
    secureSet(SESSION_USER_KEY, meta.userId),
    meta.createdAt
      ? secureSet(SESSION_CREATED_KEY, meta.createdAt)
      : secureDelete(SESSION_CREATED_KEY),
  ]);
  if (__DEV__) {
    console.log("[AuthSession] currentSession=redacted saved");
  }
}

export async function getActiveSessionMeta(): Promise<ActiveSessionMeta | null> {
  if (memoryMeta) return memoryMeta;
  const sessionId = await secureGet(SESSION_ID_KEY);
  const userId = await secureGet(SESSION_USER_KEY);
  if (!sessionId?.trim() || !userId?.trim()) return null;
  const sessionGeneration = (await secureGet(SESSION_GEN_KEY)) ?? undefined;
  const createdAt = (await secureGet(SESSION_CREATED_KEY)) ?? undefined;
  memoryMeta = {
    sessionId: sessionId.trim(),
    userId: userId.trim(),
    sessionGeneration: sessionGeneration?.trim() || undefined,
    createdAt: createdAt?.trim() || undefined,
  };
  return memoryMeta;
}

export async function clearActiveSessionMeta(): Promise<void> {
  memoryMeta = null;
  await Promise.all([
    secureDelete(SESSION_ID_KEY),
    secureDelete(SESSION_GEN_KEY),
    secureDelete(SESSION_USER_KEY),
    secureDelete(SESSION_CREATED_KEY),
  ]);
}

export function getActiveSessionIdSync(): string | null {
  return memoryMeta?.sessionId ?? null;
}
