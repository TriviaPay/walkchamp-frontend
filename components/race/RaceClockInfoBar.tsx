/**
 * Live-race clock + participant info cards.
 * Owns the 1s tick so live-detail parent is not forced to re-render every second.
 */
import React, { memo } from "react";
import { Text, View } from "react-native";
import { useTickingNow } from "@/components/perf/LiveClockText";

function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
}

function fmtCountdown(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
}

type StyleBag = {
  infoCard: object;
  infoRow: object;
  infoIcon: object;
  infoLbl: object;
  infoVal: object;
};

type Props = {
  enabled: boolean;
  isActive: boolean;
  isCompleted: boolean;
  isSponsored: boolean;
  startedAtMs: number | null;
  completedAtMs: number | null;
  statusLabel: string;
  timerColor?: string;
  participantValue: string;
  styles: StyleBag;
};

export const RaceClockInfoBar = memo(function RaceClockInfoBar({
  enabled,
  isActive,
  isCompleted,
  isSponsored,
  startedAtMs,
  completedAtMs,
  statusLabel,
  timerColor,
  participantValue,
  styles: s,
}: Props) {
  const now = useTickingNow(enabled && !isCompleted);
  const elapsed = startedAtMs
    ? Math.max(0, Math.floor(((completedAtMs ?? now) - startedAtMs) / 1000))
    : 0;
  const SPONSORED_DURATION_S = 3 * 60 * 60;
  const sponsoredRemaining = Math.max(0, SPONSORED_DURATION_S - elapsed);

  const infoTimeLabel = isCompleted
    ? "TIME"
    : isActive && isSponsored
      ? "TIME LEFT"
      : isActive
        ? "TIME"
        : "STATUS";

  const infoTimeValue =
    isCompleted || isActive
      ? isActive && isSponsored
        ? fmtCountdown(sponsoredRemaining)
        : fmtTime(elapsed)
      : statusLabel;

  const color =
    timerColor ??
    (isActive && isSponsored
      ? sponsoredRemaining < 30 * 60
        ? "#FF4444"
        : sponsoredRemaining < 60 * 60
          ? "#FFAA00"
          : "#00E676"
      : undefined);

  const cards = [
    {
      icon: isActive ? "⏱" : isCompleted ? "🏁" : "•",
      label: infoTimeLabel,
      value: infoTimeValue,
      color,
    },
    {
      icon: "👥",
      label: "PARTICIPANTS",
      value: participantValue,
      color: undefined as string | undefined,
    },
  ];

  return (
    <>
      {cards.map((card) => (
        <View key={card.label} style={s.infoCard}>
          <View style={s.infoRow}>
            <Text style={s.infoIcon}>{card.icon}</Text>
            <Text style={[s.infoLbl, card.color ? { color: card.color } : null]}>{card.label}</Text>
          </View>
          <Text
            style={[s.infoVal, card.color ? { color: card.color } : null]}
            numberOfLines={1}
          >
            {card.value}
          </Text>
        </View>
      ))}
    </>
  );
});
