/**
 * StepAudit — development-only instrumentation for false-step investigation.
 *
 * Rules (Phase 1):
 * - Never mutates step state or timing
 * - No tokens / PII / full health records
 * - Gated by STEP_SYNC_CONFIG.STEP_AUDIT_ENABLED (defaults to __DEV__)
 * - Disable before production release builds if needed
 */

import { AppState, type AppStateStatus } from "react-native";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { getTodayKey } from "@/utils/format";

export type StepAuditProviderLabel =
  | "health_connect"
  | "android_counter"
  | "ios_pedometer"
  | "none"
  | "unknown";

export type StepAuditEventOrigin =
  | "subscribe"
  | "watch"
  | "poll"
  | "hydrate"
  | "resume"
  | "fgs"
  | "api"
  | "merge"
  | "source_switch"
  | "phantom"
  | "sync";

type AuditFields = Record<string, string | number | boolean | null | undefined>;

const PROVIDER_INSTANCE_ID = `spa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

let providerStartCount = 0;
let providerStopCount = 0;
let activeWatchListeners = 0;
let lastProviderLabel: StepAuditProviderLabel = "none";
let lastRawSensorTotal: number | null = null;
let lastDailySteps: number | null = null;
let lastSyncRequestId: string | null = null;
let lastSyncAtMs = 0;
let lastLoggedSignature = "";
let lastLoggedAtMs = 0;

const THROTTLE_MS = 400;

function auditEnabled(): boolean {
  return (
    typeof __DEV__ !== "undefined" &&
    __DEV__ &&
    STEP_SYNC_CONFIG.STEP_AUDIT_ENABLED === true
  );
}

function appStateLabel(): AppStateStatus {
  return AppState.currentState;
}

function mapProviderId(id: string | null | undefined): StepAuditProviderLabel {
  if (!id) return "none";
  if (id === "android_health_connect") return "health_connect";
  if (id === "android_legacy_sensor" || id === "android_step_counter") {
    return "android_counter";
  }
  if (id === "ios_healthkit") return "ios_pedometer";
  return "unknown";
}

function redactSourceId(raw: string): string {
  // Keep only a short stable fingerprint — not the full package/app name dump.
  const s = String(raw ?? "").trim();
  if (!s) return "empty";
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return `src_${(hash >>> 0).toString(16)}`;
}

function formatFields(fields: AuditFields): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${v === null ? "null" : String(v)}`)
    .join(" ");
}

function emit(fields: AuditFields, opts?: { force?: boolean }): void {
  if (!auditEnabled()) return;

  const signature = formatFields(fields);
  const now = Date.now();
  if (
    !opts?.force &&
    signature === lastLoggedSignature &&
    now - lastLoggedAtMs < THROTTLE_MS
  ) {
    return;
  }
  lastLoggedSignature = signature;
  lastLoggedAtMs = now;

  console.log(
    `[StepAudit] ${formatFields({
      providerInstanceId: PROVIDER_INSTANCE_ID,
      providerStartCount,
      providerStopCount,
      activeProviderCount: lastProviderLabel === "none" ? 0 : 1,
      listenerCount: activeWatchListeners,
      appState: appStateLabel(),
      localDate: getTodayKey(),
      ...fields,
    })}`,
  );
}

export const stepAudit = {
  isEnabled: auditEnabled,

  providerLabelFromId: mapProviderId,

  noteProviderStart(providerId: string | null | undefined): void {
    if (!auditEnabled()) return;
    providerStartCount += 1;
    const next = mapProviderId(providerId);
    const prev = lastProviderLabel;
    lastProviderLabel = next;
    emit(
      {
        provider: next,
        eventOrigin: "source_switch",
        sourceChangedFrom: prev,
        sourceChangedTo: next,
      },
      { force: true },
    );
  },

  noteProviderStop(providerId?: string | null): void {
    if (!auditEnabled()) return;
    providerStopCount += 1;
    emit(
      {
        provider: mapProviderId(providerId) || lastProviderLabel,
        eventOrigin: "source_switch",
      },
      { force: true },
    );
  },

  noteWatchListenerDelta(delta: 1 | -1, providerId?: string | null): void {
    if (!auditEnabled()) return;
    activeWatchListeners = Math.max(0, activeWatchListeners + delta);
    emit(
      {
        provider: mapProviderId(providerId) || lastProviderLabel,
        eventOrigin: delta > 0 ? "subscribe" : "watch",
        listenerCount: activeWatchListeners,
      },
      { force: true },
    );
  },

  noteSourceSwitch(
    fromId: string | null | undefined,
    toId: string | null | undefined,
  ): void {
    if (!auditEnabled()) return;
    const from = mapProviderId(fromId);
    const to = mapProviderId(toId);
    lastProviderLabel = to;
    emit(
      {
        provider: to,
        eventOrigin: "source_switch",
        sourceChangedFrom: from,
        sourceChangedTo: to,
      },
      { force: true },
    );
  },

  noteSensorTick(input: {
    providerId?: string | null;
    rawSensorTotal?: number | null;
    dailyBaseline?: number | null;
    calculatedDailySteps?: number | null;
    raceBaseline?: number | null;
    calculatedRaceSteps?: number | null;
    eventOrigin: StepAuditEventOrigin;
    phantomEventDetected?: boolean;
    suspiciousIncreaseReason?: string | null;
    raceId?: string | null;
  }): void {
    if (!auditEnabled()) return;
    const prevRaw = lastRawSensorTotal;
    const prevDaily = lastDailySteps;
    if (typeof input.rawSensorTotal === "number") {
      lastRawSensorTotal = input.rawSensorTotal;
    }
    if (typeof input.calculatedDailySteps === "number") {
      lastDailySteps = input.calculatedDailySteps;
    }

    let suspicious = input.suspiciousIncreaseReason ?? null;
    if (
      !suspicious &&
      typeof input.calculatedDailySteps === "number" &&
      typeof prevDaily === "number" &&
      input.calculatedDailySteps - prevDaily > STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE
    ) {
      suspicious = "daily_jump_exceeds_WALK_MAX_STEP_SPIKE";
    }

    emit({
      provider: mapProviderId(input.providerId) || lastProviderLabel,
      eventOrigin: input.eventOrigin,
      rawSensorTotal: input.rawSensorTotal ?? null,
      previousRawSensorTotal: prevRaw,
      dailyBaseline: input.dailyBaseline ?? null,
      calculatedDailySteps: input.calculatedDailySteps ?? null,
      previousDailySteps: prevDaily,
      raceBaseline: input.raceBaseline ?? null,
      calculatedRaceSteps: input.calculatedRaceSteps ?? null,
      phantomEventDetected: input.phantomEventDetected === true,
      raceId: input.raceId ?? null,
      suspiciousIncreaseReason: suspicious,
    });
  },

  noteMerge(input: {
    providerId?: string | null;
    eventOrigin?: StepAuditEventOrigin;
    displayMergeInputs: string;
    displayMergeResult: number;
    cachedDailySteps?: number | null;
    backendDailySteps?: number | null;
    calculatedDailySteps?: number | null;
  }): void {
    if (!auditEnabled()) return;
    emit({
      provider: mapProviderId(input.providerId) || lastProviderLabel,
      eventOrigin: input.eventOrigin ?? "merge",
      displayMergeInputs: input.displayMergeInputs,
      displayMergeResult: input.displayMergeResult,
      cachedDailySteps: input.cachedDailySteps ?? null,
      backendDailySteps: input.backendDailySteps ?? null,
      calculatedDailySteps: input.calculatedDailySteps ?? null,
      notificationReadOnly: true,
    });
  },

  noteHealthConnectRead(input: {
    method: "aggregate" | "readRecords";
    steps: number;
    recordCount?: number;
    dataOrigins?: string[] | null;
    eventOrigin?: StepAuditEventOrigin;
  }): void {
    if (!auditEnabled()) return;
    const origins = (input.dataOrigins ?? []).map(redactSourceId);
    emit({
      provider: "health_connect",
      eventOrigin: input.eventOrigin ?? "poll",
      calculatedDailySteps: input.steps,
      healthConnectSourceCount: origins.length || input.recordCount || 0,
      healthConnectSources: origins.length ? origins.join(",") : "none",
      syncMode: input.method === "aggregate" ? "absolute" : "absolute",
      displayMergeInputs: `hc_method=${input.method};records=${input.recordCount ?? 0}`,
    });
  },

  noteSync(input: {
    providerId?: string | null;
    syncMode: "absolute" | "delta";
    delta?: number;
    totalSteps?: number;
    backendDailySteps?: number | null;
    outboxEntryId?: string | null;
  }): void {
    if (!auditEnabled()) return;
    const syncRequestId = `sync_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const duplicateSync =
      lastSyncRequestId != null &&
      now - lastSyncAtMs < 1500 &&
      typeof input.totalSteps === "number" &&
      typeof lastDailySteps === "number" &&
      input.totalSteps === lastDailySteps;
    lastSyncRequestId = syncRequestId;
    lastSyncAtMs = now;
    emit(
      {
        provider: mapProviderId(input.providerId) || lastProviderLabel,
        eventOrigin: "sync",
        syncRequestId,
        syncMode: input.syncMode,
        duplicateSync,
        calculatedDailySteps: input.totalSteps ?? null,
        backendDailySteps: input.backendDailySteps ?? null,
        outboxEntryId: input.outboxEntryId ?? null,
        displayMergeInputs:
          typeof input.delta === "number" ? `delta=${input.delta}` : undefined,
      },
      { force: true },
    );
  },

  notePhantom(input: {
    providerId?: string | null;
    eventOrigin: StepAuditEventOrigin;
    previousDailySteps?: number;
    calculatedDailySteps?: number;
    reason?: string;
  }): void {
    if (!auditEnabled()) return;
    emit(
      {
        provider: mapProviderId(input.providerId) || lastProviderLabel,
        eventOrigin: "phantom",
        phantomEventDetected: true,
        previousDailySteps: input.previousDailySteps ?? null,
        calculatedDailySteps: input.calculatedDailySteps ?? null,
        suspiciousIncreaseReason: input.reason ?? "phantom_guard",
      },
      { force: true },
    );
  },

  /** Snapshot helper for ad-hoc call sites. */
  log(fields: AuditFields, force = false): void {
    emit(fields, { force });
  },
};
