import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { getSponsoredEventWindowParts } from "@/utils/timezone";

/** Match live challenge cards: highlight times in yellow. */
const TIME_YELLOW = "#FACC15";

/**
 * Renders "Start time … · End time …" with time values highlighted
 * like ChallengeEndsPillLabel on live challenge cards.
 */
export function SponsoredEventWindowLabel({
  startIso,
  endIso,
  style,
}: {
  startIso: string | null | undefined;
  endIso?: string | null | undefined;
  style?: StyleProp<TextStyle>;
}) {
  const parts = getSponsoredEventWindowParts(startIso, endIso);
  if (!parts) return null;

  return (
    <Text style={style}>
      Start time{" "}
      <Text style={{ color: TIME_YELLOW, fontWeight: "800" }}>{parts.startTime}</Text>
      {parts.endValue ? (
        <>
          {" · "}
          End time{" "}
          <Text style={{ color: TIME_YELLOW, fontWeight: "800" }}>{parts.endValue}</Text>
        </>
      ) : null}
    </Text>
  );
}
