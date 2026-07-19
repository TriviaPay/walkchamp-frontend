import React from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";
import { getSponsoredEventWindowParts } from "@/utils/timezone";

/** Match live challenge cards: highlight times in yellow. */
const TIME_YELLOW = "#FACC15";

/**
 * Renders "Start time … · End time …" with time values highlighted
 * like ChallengeEndsPillLabel on live challenge cards.
 *
 * Uses sibling Text nodes (not nested Text) so opacity fades on Android
 * do not remount/blink the yellow time spans.
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
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", flexShrink: 1 }}>
      <Text style={style}>Start time </Text>
      <Text style={[style, { color: TIME_YELLOW, fontWeight: "800" }]}>{parts.startTime}</Text>
      {parts.endValue ? (
        <>
          <Text style={style}> · End time </Text>
          <Text style={[style, { color: TIME_YELLOW, fontWeight: "800" }]}>{parts.endValue}</Text>
        </>
      ) : null}
    </View>
  );
}
