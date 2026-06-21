import React from "react";
import { View, ViewStyle, StyleProp } from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { MAX_CONTENT_WIDTH, isTablet } from "@/utils/responsive";

export type ScreenEdge = "top" | "bottom";

interface ScreenContainerProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Safe-area edges to pad. Default: top + bottom. */
  edges?: ScreenEdge[];
  /** Extra padding below safeBottom (e.g. tab bar height on tab screens). */
  bottomInset?: number;
  backgroundColor?: string;
  /** Center content with max width on tablets. */
  constrained?: boolean;
}

/**
 * Root screen wrapper with platform-aware safe-area padding for iOS and Android.
 * Use on stack screens and full-screen modals so content never sits under the
 * status bar, notch, Dynamic Island, or system navigation bar.
 */
export default function ScreenContainer({
  children,
  style,
  edges = ["top", "bottom"],
  bottomInset = 0,
  backgroundColor,
  constrained = false,
}: ScreenContainerProps) {
  const { safeTop, safeBottom } = useSafeLayout();
  const paddingTop = edges.includes("top") ? safeTop : 0;
  const paddingBottom = edges.includes("bottom") ? safeBottom + bottomInset : bottomInset;

  const inner = constrained && isTablet ? (
    <View style={{ flex: 1, width: "100%", maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center" }}>
      {children}
    </View>
  ) : (
    children
  );

  return (
    <View style={[{ flex: 1, paddingTop, paddingBottom, backgroundColor }, style]}>
      {inner}
    </View>
  );
}
