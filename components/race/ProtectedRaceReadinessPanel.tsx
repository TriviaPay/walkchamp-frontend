/**
 * Protected-race readiness UI for matchmaking / pre-start gates.
 */

import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";
import type { PrizeRaceReadiness } from "@/services/raceVerification/raceVerificationTypes";
import {
  PRIZE_PHONE_ONLY_DISCLOSURE,
  PRIZE_TRACKER_NOT_READY_MESSAGE,
} from "@/services/raceVerification/prizeStatusLabels";

type CheckItem = {
  key: string;
  label: string;
  ok: boolean;
};

function buildChecks(readiness: PrizeRaceReadiness): CheckItem[] {
  return [
    { key: "device", label: "Registered phone", ok: readiness.registeredDeviceReady },
    { key: "sensor", label: "Step sensor", ok: readiness.sensorReady },
    {
      key: "health",
      label: "Health Connect / HealthKit",
      ok: readiness.healthPlatformReady,
    },
    {
      key: "source",
      label: "WalkChamp qualifying step source",
      ok: readiness.approvedSourceReady,
    },
    {
      key: "integrity",
      label: "Secure device verification",
      ok: readiness.integrityReady,
    },
    {
      key: "network",
      label: "Internet connection",
      ok: readiness.connectivityReady,
    },
  ];
}

export function ProtectedRaceReadinessPanel({
  readiness,
  loading,
  onFixStepTracking,
}: {
  readiness: PrizeRaceReadiness | null;
  loading?: boolean;
  onFixStepTracking?: () => void;
}) {
  const c = useColors();
  const checks = useMemo(
    () => (readiness ? buildChecks(readiness) : []),
    [readiness],
  );

  if (loading) {
    return (
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <ActivityIndicator color={c.primary} />
        <Text style={[styles.title, { color: c.foreground }]}>
          Checking race readiness...
        </Text>
      </View>
    );
  }

  if (!readiness) return null;

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.title, { color: c.foreground }]}>
        {readiness.eligible ? "Ready to Race" : "Checking race readiness..."}
      </Text>
      {checks.map((item) => (
        <View key={item.key} style={styles.row}>
          <Text style={[styles.icon, { color: item.ok ? "#00E676" : c.mutedForeground }]}>
            {item.ok ? "✓" : "○"}
          </Text>
          <Text style={[styles.label, { color: c.foreground }]}>{item.label}</Text>
        </View>
      ))}
      {!readiness.eligible ? (
        <>
          <Text style={[styles.warn, { color: c.mutedForeground }]}>
            {PRIZE_TRACKER_NOT_READY_MESSAGE}
          </Text>
          {onFixStepTracking ? (
            <TouchableOpacity
              style={[styles.fixBtn, { backgroundColor: c.primary }]}
              onPress={onFixStepTracking}
            >
              <Text style={styles.fixBtnText}>Fix Step Tracking</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : (
        <Text style={[styles.disclosure, { color: c.mutedForeground }]}>
          {PRIZE_PHONE_ONLY_DISCLOSURE}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: rs(14),
    padding: rs(16),
    gap: rs(8),
  },
  title: {
    fontSize: rf(16),
    fontWeight: "700",
    marginBottom: rs(4),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
  },
  icon: {
    fontSize: rf(14),
    width: rs(18),
  },
  label: {
    fontSize: rf(14),
    flex: 1,
  },
  warn: {
    fontSize: rf(13),
    marginTop: rs(6),
  },
  disclosure: {
    fontSize: rf(12),
    marginTop: rs(8),
    lineHeight: rf(17),
  },
  fixBtn: {
    marginTop: rs(10),
    borderRadius: rs(10),
    paddingVertical: rs(10),
    alignItems: "center",
  },
  fixBtnText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: rf(14),
  },
});
