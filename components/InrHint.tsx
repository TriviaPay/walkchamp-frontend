import React from "react";
import { Text, View, type StyleProp, type TextStyle } from "react-native";

import { getInrHintLabel } from "@/utils/currencyDisplay";

function flatten(style?: StyleProp<TextStyle>): TextStyle {
  if (!style) return {};
  if (Array.isArray(style)) {
    return (style as StyleProp<TextStyle>[]).reduce<TextStyle>(
      (acc, s) => ({ ...acc, ...flatten(s) }),
      {},
    );
  }
  return style as TextStyle;
}

/**
 * "(≈₹YYY)" for Indian users. Use `below` so the dollar amount keeps its original
 * size — the rupee line sits under it in a smaller, still-readable font.
 * Renders nothing for non-Indian users or zero amounts.
 */
export function InrHint({
  usd,
  style,
  color,
  below = false,
}: {
  usd: number;
  style?: StyleProp<TextStyle>;
  color?: string;
  below?: boolean;
}) {
  const label = getInrHintLabel(usd);
  if (!label) return null;

  const base = flatten(style);
  const baseSize = typeof base.fontSize === "number" ? base.fontSize : 13;
  const hintSize = below
    ? Math.max(10, Math.round(baseSize * 0.52))
    : Math.max(9, Math.round(baseSize * 0.62));

  return (
    <Text
      style={{
        fontSize: hintSize,
        fontWeight: "500",
        color: color ?? (base.color as string | undefined),
        opacity: color ? 1 : 0.75,
        marginTop: below ? 1 : 0,
      }}
    >
      {below ? label : ` ${label}`}
    </Text>
  );
}

/** Dollar line unchanged; INR sits underneath in a smaller font. Alignment stays as-is. */
export function UsdAmountWithInr({
  usd,
  label,
  style,
  color,
  align = "flex-end",
}: {
  usd: number;
  label: string;
  style?: StyleProp<TextStyle>;
  color?: string;
  align?: "flex-end" | "center" | "flex-start";
}) {
  return (
    <View style={{ alignItems: align, flexShrink: 1 }}>
      <Text style={[style, color ? { color } : null]} numberOfLines={1}>
        {label}
      </Text>
      <InrHint usd={usd} below style={[style, color ? { color } : null]} />
    </View>
  );
}
