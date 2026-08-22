import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import {
  getInrHintLabel,
  getUsdAmountColor,
  INR_AMOUNT_COLOR,
} from "@/utils/currencyDisplay";

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
 * "(≈₹YYY)" for Indian users, rendered inline next to the USD amount.
 * Safe as a nested `<Text>` child. Renders nothing for non-Indian users or zero amounts.
 */
export function InrHint({
  usd,
  style,
  color,
}: {
  usd: number;
  style?: StyleProp<TextStyle>;
  color?: string;
  /** @deprecated INR is always inline now; kept so older call sites still type-check. */
  below?: boolean;
}) {
  const label = getInrHintLabel(usd);
  if (!label) return null;

  const base = flatten(style);
  const baseSize = typeof base.fontSize === "number" ? base.fontSize : 13;
  const hintSize = Math.max(11, Math.round(baseSize * 0.92));

  return (
    <Text
      style={{
        fontSize: hintSize,
        fontWeight: "700",
        color: color ?? INR_AMOUNT_COLOR,
      }}
    >
      {` ${label}`}
    </Text>
  );
}

/** "$X.XX (≈₹YYY)" on one wrapping line — Indian: USD blue + INR yellow; others: USD yellow only. */
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
  const inrLabel = getInrHintLabel(usd);
  const base = flatten(style);
  const baseSize = typeof base.fontSize === "number" ? base.fontSize : 13;
  const textAlign = align === "center" ? "center" : align === "flex-start" ? "left" : "right";
  const usdColor = color ?? getUsdAmountColor();

  return (
    <Text
      style={[
        style,
        {
          color: usdColor,
          flexShrink: 1,
          textAlign,
        },
      ]}
    >
      {label}
      {inrLabel ? (
        <Text
          style={{
            color: INR_AMOUNT_COLOR,
            fontWeight: "700",
            fontSize: Math.max(11, Math.round(baseSize * 0.92)),
          }}
        >
          {` ${inrLabel}`}
        </Text>
      ) : null}
    </Text>
  );
}
