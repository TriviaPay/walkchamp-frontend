/**
 * Detects Streak Challenge device timezone drift, sticky banner, and Walk modal.
 * Confirms via POST /api/streak-challenges/:id/timezone — never recalculates days locally.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, type AppStateStatus } from "react-native";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { getDeviceTimezone } from "@/utils/timezone";
import {
  deviceIanaTimezone,
  postUnlimitedTimezoneChange,
  timezoneChangeErrorMessage,
  type UnlimitedTimezoneChangeResult,
} from "@/features/unlimited/api/unlimitedTimezoneApi";
import {
  shouldShowTimezoneDetectBanner,
  shouldSilentlyAcknowledgeDeviceTimezone,
  type TimezoneChangeModalStage,
  type UnlimitedTimezoneSnapshot,
} from "@/features/unlimited/mappers/unlimitedTimezoneChange";
import { mapUnlimitedDetailToLiveDetail } from "@/utils/unlimitedLiveRace";
import { CHANNELS, subscribeToChannel } from "@/services/realtimeService";
import { AppAlert } from "@/components/AppAlert";
import { logger } from "@/utils/logger";
import {
  loadLastObservedDeviceTimezone,
  saveLastObservedDeviceTimezone,
} from "@/utils/unlimitedTimezoneDetectStorage";
import { streakChallengeIdPath, streakChallengePath } from "@/features/unlimited/api/streakChallengePaths";

type DetectBanner = {
  challengeId: string;
  currentTimezone: string;
  deviceTimezone: string;
};

type UnlimitedTimezoneContextValue = {
  snapshot: UnlimitedTimezoneSnapshot | null;
  deviceTimezone: string;
  detectBanner: DetectBanner | null;
  modalStage: TimezoneChangeModalStage | null;
  lastChangeResult: UnlimitedTimezoneChangeResult | null;
  confirming: boolean;
  refreshTimezoneSnapshot: (challengeId?: string) => Promise<void>;
  openReviewModal: () => Promise<void>;
  confirmDeviceTimezone: () => Promise<void>;
  keepCurrentTimezone: () => void;
  dismissModal: () => void;
  applyExternalSnapshot: (snap: UnlimitedTimezoneSnapshot) => void;
};

const UnlimitedTimezoneContext = createContext<UnlimitedTimezoneContextValue | null>(null);

function extractSnapshotFromDetail(
  challengeId: string,
  payload: unknown,
): UnlimitedTimezoneSnapshot | null {
  const mapped = mapUnlimitedDetailToLiveDetail(payload);
  if (!mapped) return null;
  return {
    challengeId,
    viewerTimezone: mapped.race.viewerTimezone ?? null,
    accountTimezone: mapped.race.accountTimezone ?? null,
    pendingTimezone: mapped.race.pendingTimezone ?? null,
    timezoneEffectiveDay: mapped.race.timezoneEffectiveDay ?? null,
    timezoneChangeAppliesToChallenge: mapped.race.timezoneChangeAppliesToChallenge ?? null,
    finalDayTimezoneLocked: mapped.race.finalDayTimezoneLocked ?? null,
    currentDayIndex: mapped.race.currentDayIndex ?? null,
    challengeDurationDays: mapped.race.challengeDurationDays ?? null,
    challengeStatus: mapped.race.rawStatus ?? mapped.race.status ?? null,
    viewerStatus: mapped.race.viewerStatus ?? null,
  };
}

export function UnlimitedTimezoneProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const [deviceTimezone, setDeviceTimezone] = useState(deviceIanaTimezone);
  const [snapshot, setSnapshot] = useState<UnlimitedTimezoneSnapshot | null>(null);
  const [modalStage, setModalStage] = useState<TimezoneChangeModalStage | null>(null);
  const [lastChangeResult, setLastChangeResult] =
    useState<UnlimitedTimezoneChangeResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lastObservedDeviceTz, setLastObservedDeviceTz] = useState<string | null>(null);
  const [detectBaselineReady, setDetectBaselineReady] = useState(false);
  const challengeIdRef = useRef<string | null>(null);
  const refreshInFlight = useRef(false);

  const acknowledgeDeviceTimezone = useCallback(
    async (timezone: string = deviceIanaTimezone()) => {
      const tz = timezone.trim();
      if (!tz) return;
      setLastObservedDeviceTz(tz);
      if (user?.id) {
        await saveLastObservedDeviceTimezone(user.id, tz);
      }
    },
    [user?.id],
  );

  const refreshTimezoneSnapshot = useCallback(async (challengeId?: string) => {
    if (refreshInFlight.current) return;
    const id = challengeId ?? challengeIdRef.current;
    refreshInFlight.current = true;
    try {
      setDeviceTimezone(deviceIanaTimezone());

      if (id) {
        const res = await authFetch(streakChallengeIdPath(id));
        if (res.ok) {
          const json = await res.json().catch(() => null);
          const snap = extractSnapshotFromDetail(id, json);
          if (snap) {
            challengeIdRef.current = id;
            setSnapshot(snap);
            return;
          }
        }
      }

      // Discover active membership.
      const activeRes = await authFetch(streakChallengePath("/my-active"));
      if (!activeRes.ok) {
        setSnapshot(null);
        challengeIdRef.current = null;
        return;
      }
      const activeJson = (await activeRes.json().catch(() => null)) as
        | { challenges?: unknown[] }
        | unknown
        | null;
      const rows = Array.isArray((activeJson as { challenges?: unknown[] })?.challenges)
        ? ((activeJson as { challenges: unknown[] }).challenges)
        : Array.isArray(activeJson)
          ? activeJson
          : [];
      const first = rows[0];
      if (!first || typeof first !== "object") {
        setSnapshot(null);
        challengeIdRef.current = null;
        return;
      }
      const row = first as Record<string, unknown>;
      const cid =
        (typeof row.id === "string" && row.id) ||
        (typeof row.challengeId === "string" && row.challengeId) ||
        null;
      if (!cid) {
        setSnapshot(null);
        challengeIdRef.current = null;
        return;
      }
      const detailRes = await authFetch(streakChallengeIdPath(cid));
      if (!detailRes.ok) {
        // Fall back to my-active viewer block if present.
        const viewer = (row.viewer && typeof row.viewer === "object"
          ? row.viewer
          : row) as Record<string, unknown>;
        challengeIdRef.current = cid;
        setSnapshot({
          challengeId: cid,
          viewerTimezone:
            typeof viewer.viewerTimezone === "string"
              ? viewer.viewerTimezone
              : typeof viewer.participantTimezone === "string"
                ? viewer.participantTimezone
                : null,
          accountTimezone:
            typeof viewer.accountTimezone === "string" ? viewer.accountTimezone : null,
          pendingTimezone:
            typeof viewer.pendingTimezone === "string" ? viewer.pendingTimezone : null,
          timezoneEffectiveDay:
            typeof viewer.timezoneEffectiveDay === "number"
              ? viewer.timezoneEffectiveDay
              : null,
          timezoneChangeAppliesToChallenge:
            typeof viewer.timezoneChangeAppliesToChallenge === "boolean"
              ? viewer.timezoneChangeAppliesToChallenge
              : null,
          finalDayTimezoneLocked:
            typeof viewer.finalDayTimezoneLocked === "boolean"
              ? viewer.finalDayTimezoneLocked
              : null,
          currentDayIndex:
            typeof viewer.currentDayIndex === "number" ? viewer.currentDayIndex : null,
          challengeDurationDays:
            typeof row.durationDays === "number"
              ? row.durationDays
              : typeof row.challengeDurationDays === "number"
                ? row.challengeDurationDays
                : null,
          challengeStatus:
            typeof row.status === "string"
              ? row.status
              : typeof (row.challenge as { status?: string })?.status === "string"
                ? (row.challenge as { status: string }).status
                : null,
          viewerStatus:
            typeof viewer.viewerStatus === "string" ? viewer.viewerStatus : null,
        });
        return;
      }
      const detailJson = await detailRes.json().catch(() => null);
      const snap = extractSnapshotFromDetail(cid, detailJson);
      challengeIdRef.current = cid;
      setSnapshot(snap);
    } catch (err) {
      logger.warn("UnlimitedTimezone", "refresh failed", err);
    } finally {
      refreshInFlight.current = false;
    }
  }, []);

  const applyExternalSnapshot = useCallback((snap: UnlimitedTimezoneSnapshot) => {
    challengeIdRef.current = snap.challengeId;
    setSnapshot(snap);
    setDeviceTimezone(deviceIanaTimezone());
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user?.id) {
      setSnapshot(null);
      challengeIdRef.current = null;
      setModalStage(null);
      setLastObservedDeviceTz(null);
      setDetectBaselineReady(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const stored = await loadLastObservedDeviceTimezone(user.id);
      const device = deviceIanaTimezone();
      if (cancelled) return;
      if (!stored) {
        await saveLastObservedDeviceTimezone(user.id, device);
        setLastObservedDeviceTz(device);
      } else {
        setLastObservedDeviceTz(stored);
      }
      setDetectBaselineReady(true);
      void refreshTimezoneSnapshot();
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, loading, refreshTimezoneSnapshot]);

  // Re-check when app returns / timezone may have changed (travel).
  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next === "active" && user?.id) {
        setDeviceTimezone(getDeviceTimezone());
        void refreshTimezoneSnapshot();
      }
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, [user?.id, refreshTimezoneSnapshot]);

  // Realtime: timezone_changed on unlimited + race channels.
  useEffect(() => {
    const id = snapshot?.challengeId;
    if (!id || !user?.id) return;

    const onTz = () => {
      void refreshTimezoneSnapshot(id);
    };

    const unl = subscribeToChannel(CHANNELS.unlimitedChallenge(id));
    const race = subscribeToChannel(CHANNELS.liveRace(id));
    unl?.bind("timezone_changed", onTz);
    race?.bind("timezone_changed", onTz);
    race?.bind("race:timezone-changed", onTz);

    return () => {
      unl?.unbind("timezone_changed", onTz);
      race?.unbind("timezone_changed", onTz);
      race?.unbind("race:timezone-changed", onTz);
    };
  }, [snapshot?.challengeId, user?.id, refreshTimezoneSnapshot]);

  const detectBanner = useMemo((): DetectBanner | null => {
    if (!detectBaselineReady || !snapshot?.viewerTimezone) return null;
    if (!shouldShowTimezoneDetectBanner(snapshot, deviceTimezone, lastObservedDeviceTz)) {
      return null;
    }
    return {
      challengeId: snapshot.challengeId,
      currentTimezone: snapshot.viewerTimezone,
      deviceTimezone,
    };
  }, [snapshot, deviceTimezone, lastObservedDeviceTz, detectBaselineReady]);

  // Travel back to the challenge timezone — advance baseline without prompting.
  useEffect(() => {
    if (!detectBaselineReady || !snapshot) return;
    if (
      !shouldSilentlyAcknowledgeDeviceTimezone(
        deviceTimezone,
        lastObservedDeviceTz,
        snapshot.viewerTimezone,
      )
    ) {
      return;
    }
    void acknowledgeDeviceTimezone(deviceTimezone);
  }, [
    detectBaselineReady,
    snapshot,
    deviceTimezone,
    lastObservedDeviceTz,
    acknowledgeDeviceTimezone,
  ]);

  const dismissModal = useCallback(() => {
    setModalStage((stage) => {
      // Informational stages: acknowledge this device TZ so we do not re-prompt.
      if (stage === "updated" || stage === "final_day_locked") {
        void acknowledgeDeviceTimezone();
      }
      return null;
    });
  }, [acknowledgeDeviceTimezone]);

  const openReviewModal = useCallback(async () => {
    if (!detectBanner) return;
    setDeviceTimezone(deviceIanaTimezone());
    await refreshTimezoneSnapshot();
    setLastChangeResult(null);
    setModalStage("detect");
  }, [refreshTimezoneSnapshot, detectBanner]);

  const keepCurrentTimezone = useCallback(() => {
    void acknowledgeDeviceTimezone();
    setModalStage(null);
  }, [acknowledgeDeviceTimezone]);

  const confirmDeviceTimezone = useCallback(async () => {
    const id = snapshot?.challengeId;
    if (!id) return;
    setConfirming(true);
    try {
      const tz = deviceIanaTimezone();
      const res = await postUnlimitedTimezoneChange(id, tz);
      if (!res.ok) {
        AppAlert.alert(
          "Timezone update failed",
          timezoneChangeErrorMessage(res.code, res.error),
        );
        return;
      }
      setLastChangeResult(res.result);
      await acknowledgeDeviceTimezone(tz);
      await refreshTimezoneSnapshot(id);
      if (res.result.finalDayTimezoneLocked || !res.result.appliesToChallenge) {
        setModalStage("final_day_locked");
      } else {
        setModalStage("updated");
      }
    } finally {
      setConfirming(false);
    }
  }, [snapshot?.challengeId, refreshTimezoneSnapshot, acknowledgeDeviceTimezone]);

  const value = useMemo(
    () => ({
      snapshot,
      deviceTimezone,
      detectBanner,
      modalStage,
      lastChangeResult,
      confirming,
      refreshTimezoneSnapshot,
      openReviewModal,
      confirmDeviceTimezone,
      keepCurrentTimezone,
      dismissModal,
      applyExternalSnapshot,
    }),
    [
      snapshot,
      deviceTimezone,
      detectBanner,
      modalStage,
      lastChangeResult,
      confirming,
      refreshTimezoneSnapshot,
      openReviewModal,
      confirmDeviceTimezone,
      keepCurrentTimezone,
      dismissModal,
      applyExternalSnapshot,
    ],
  );

  return (
    <UnlimitedTimezoneContext.Provider value={value}>
      {children}
    </UnlimitedTimezoneContext.Provider>
  );
}

export function useUnlimitedTimezone(): UnlimitedTimezoneContextValue {
  const ctx = useContext(UnlimitedTimezoneContext);
  if (!ctx) {
    throw new Error("useUnlimitedTimezone must be used within UnlimitedTimezoneProvider");
  }
  return ctx;
}

/** Safe hook when provider may be absent (e.g. tests). */
export function useUnlimitedTimezoneOptional(): UnlimitedTimezoneContextValue | null {
  return useContext(UnlimitedTimezoneContext);
}
