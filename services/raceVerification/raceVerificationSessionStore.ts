/**
 * Persist protected-race verification session across background / restart.
 * Same device + session must remain stable; do not mint a new installation ID.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import type { ProtectedRaceLocalState } from "./raceVerificationTypes";

const SECURE_KEY = "wc_prize_verify_session_v2";
const ASYNC_KEY = "wc_prize_verify_session_v2";
const UNSENT_EVIDENCE_KEY = "wc_prize_unsent_final_evidence_v1";

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

export type PersistedPrizeSession = ProtectedRaceLocalState & {
  serverChallenge?: string;
  savedAt: string;
};

export async function persistPrizeVerificationSession(
  session: PersistedPrizeSession,
): Promise<void> {
  const raw = JSON.stringify(session);
  await secureSet(SECURE_KEY, raw);
  try {
    await AsyncStorage.setItem(ASYNC_KEY, raw);
  } catch {
    /* ignore */
  }
}

export async function loadPrizeVerificationSession(): Promise<PersistedPrizeSession | null> {
  const fromSecure = await secureGet(SECURE_KEY);
  const raw =
    fromSecure ?? (await AsyncStorage.getItem(ASYNC_KEY).catch(() => null));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedPrizeSession;
    if (!parsed?.raceId || !parsed?.verificationSessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPrizeVerificationSession(): Promise<void> {
  await secureDelete(SECURE_KEY);
  try {
    await AsyncStorage.removeItem(ASYNC_KEY);
  } catch {
    /* ignore */
  }
}

export async function persistUnsentFinalEvidence(
  raceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      UNSENT_EVIDENCE_KEY,
      JSON.stringify({ raceId, payload, savedAt: new Date().toISOString() }),
    );
  } catch {
    /* ignore */
  }
}

export async function loadUnsentFinalEvidence(): Promise<{
  raceId: string;
  payload: Record<string, unknown>;
} | null> {
  try {
    const raw = await AsyncStorage.getItem(UNSENT_EVIDENCE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      raceId?: string;
      payload?: Record<string, unknown>;
    };
    if (!parsed?.raceId || !parsed.payload) return null;
    return { raceId: parsed.raceId, payload: parsed.payload };
  } catch {
    return null;
  }
}

export async function clearUnsentFinalEvidence(): Promise<void> {
  try {
    await AsyncStorage.removeItem(UNSENT_EVIDENCE_KEY);
  } catch {
    /* ignore */
  }
}
