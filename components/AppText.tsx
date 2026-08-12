/**
 * AppText — optional semantic Text wrapper for WalkChamp.
 *
 * Prefer this for shared UI (alerts, badges, section labels) when a typography
 * variant clearly matches. Do NOT mass-replace every RN Text — nested Text,
 * Reanimated, gradient masks, and special a11y props should keep raw Text.
 *
 * Overrides via `style` are intentional and supported.
 */

import React from "react";
import { Text, TextProps, StyleProp, TextStyle } from "react-native";
import {
  typography,
  type TypographyVariant,
} from "@/constants/typography";
import { MAX_FONT_SIZE_MULTIPLIER } from "@/constants/accessibility";

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  /** Optional color shortcut (merged after variant, before style). */
  color?: string;
  style?: StyleProp<TextStyle>;
};

export function AppText({
  variant = "body",
  color,
  style,
  children,
  maxFontSizeMultiplier = MAX_FONT_SIZE_MULTIPLIER,
  ...rest
}: AppTextProps) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typography[variant], color ? { color } : null, style]}
    >
      {children}
    </Text>
  );
}

/** Pre-styled helpers for common roles (same as variant prop). */
AppText.ScreenTitle = function ScreenTitle(props: Omit<AppTextProps, "variant">) {
  return <AppText variant="screenTitle" {...props} />;
};
AppText.SectionTitle = function SectionTitle(props: Omit<AppTextProps, "variant">) {
  return <AppText variant="sectionTitle" {...props} />;
};
AppText.Body = function Body(props: Omit<AppTextProps, "variant">) {
  return <AppText variant="body" {...props} />;
};
AppText.Caption = function Caption(props: Omit<AppTextProps, "variant">) {
  return <AppText variant="caption" {...props} />;
};
AppText.Button = function ButtonLabel(props: Omit<AppTextProps, "variant">) {
  return <AppText variant="button" {...props} />;
};

export default AppText;
