import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

const ENDS_ON_SEP = " • Ends on ";
/** Highlight only the calendar date + time after "Ends on". */
const DATE_TIME_YELLOW = "#FACC15";

/**
 * Renders challenge end labels like:
 *   "7 days left • Ends on 24 Jul 2026, 10:01 am"
 * with only the date/time in yellow; prefix stays the caller's text color.
 */
export function ChallengeEndsPillLabel({
  label,
  style,
}: {
  label: string;
  style?: StyleProp<TextStyle>;
}) {
  const idx = label.indexOf(ENDS_ON_SEP);
  if (idx < 0) {
    return (
      <Text style={style} numberOfLines={1}>
        {label}
      </Text>
    );
  }

  const prefix = label.slice(0, idx + ENDS_ON_SEP.length);
  const dateTime = label.slice(idx + ENDS_ON_SEP.length);

  return (
    <Text style={style} numberOfLines={1}>
      {prefix}
      <Text style={{ color: DATE_TIME_YELLOW, fontWeight: "800" }}>{dateTime}</Text>
    </Text>
  );
}
