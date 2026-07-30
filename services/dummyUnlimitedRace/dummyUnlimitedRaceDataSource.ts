/**
 * Dummy Unlimited Race simulation controller (AppState-aware).
 * Generators live in dummyUnlimitedRaceData.ts (Node-testable).
 */

import { AppState, type NativeEventSubscription } from "react-native";
import { isUnlimitedRaceDummyDataEnabled } from "@/config/featureFlags";
import {
  type DummyUnlimitedRaceSession,
  type DummyRaceParticipant,
  resortDummyRanks,
} from "./dummyUnlimitedRaceData";

export * from "./dummyUnlimitedRaceData";

type SimListener = (session: DummyUnlimitedRaceSession) => void;

let simTimer: ReturnType<typeof setInterval> | null = null;
let simSession: DummyUnlimitedRaceSession | null = null;
let simListeners = new Set<SimListener>();
let appStateSub: NativeEventSubscription | null = null;
let simPaused = false;

function tickSimulation() {
  if (!simSession || simPaused) return;
  const next = simSession.participants.map((p, i) => {
    if (p.connectionStatus === "disconnected") return p;
    const bump = i % 11 === 0 ? 3 + (i % 5) : i % 5 === 0 ? 1 : 0;
    return {
      ...p,
      currentSteps: p.currentSteps + bump,
      isSpeaking: (i + Math.floor(Date.now() / 4000)) % 17 === 0,
    } satisfies DummyRaceParticipant;
  });
  simSession = {
    ...simSession,
    participants: resortDummyRanks(next),
    race: { ...simSession.race, currentPlayers: next.length },
  };
  for (const listener of simListeners) listener(simSession);
}

/** One shared interval for dummy live updates. No-op when flag is off. */
export function startDummyUnlimitedRaceSimulation(
  session: DummyUnlimitedRaceSession,
  onUpdate: SimListener,
): () => void {
  if (!isUnlimitedRaceDummyDataEnabled()) {
    return () => {};
  }
  simSession = session;
  simListeners.add(onUpdate);
  if (!simTimer) {
    simTimer = setInterval(tickSimulation, 2500);
  }
  if (!appStateSub) {
    appStateSub = AppState.addEventListener("change", (state) => {
      simPaused = state !== "active";
    });
  }
  return () => {
    simListeners.delete(onUpdate);
    if (simListeners.size === 0) {
      if (simTimer) {
        clearInterval(simTimer);
        simTimer = null;
      }
      appStateSub?.remove();
      appStateSub = null;
      simSession = null;
      simPaused = false;
    }
  };
}
