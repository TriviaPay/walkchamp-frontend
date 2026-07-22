import React from "react";
import {
  AccessibilityInfo,
  Image,
  type ImageSourcePropType,
  PixelRatio,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { isTablet, MAX_CONTENT_WIDTH, rf, rs } from "@/utils/responsive";
import { ONBOARDING_COLORS } from "@/constants/onboarding";

const C = ONBOARDING_COLORS;

type LayoutProps = {
  children: React.ReactNode;
  step: number;
  totalSteps?: number;
  footer?: React.ReactNode;
  /** Compact top-left back (screens 2–6). */
  showBack?: boolean;
};

export function OnboardingLayout({
  children,
  step,
  totalSteps = 6,
  footer,
  showBack = false,
}: LayoutProps) {
  const { safeTop, safeBottom } = useSafeLayout();
  const { width, height } = useWindowDimensions();
  const fontScale = PixelRatio.getFontScale();
  const allowScroll = fontScale >= 1.35 || height < 700;
  const contentMax = isTablet ? Math.min(MAX_CONTENT_WIDTH, 560) : width;
  const sidePad = Math.max(rs(24), (width - contentMax) / 2);

  const content = (
    <View style={styles.contentColumn}>
      <View style={styles.topRow}>
        {showBack ? <OnboardingBackButton /> : <View style={styles.backPlaceholder} />}
        <View style={styles.progressFlex}>
          <OnboardingProgress step={step} totalSteps={totalSteps} />
        </View>
        <View style={styles.backPlaceholder} />
      </View>
      <View style={styles.body}>{children}</View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <StatusBar style="light" />
      <LinearGradient
        colors={["#224DB628", "#7C4DFF18", "transparent"]}
        style={styles.topGlow}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 0.5 }}
      />
      <View
        style={[
          styles.main,
          {
            // Clear status bar / notch with extra breathing room
            paddingTop: safeTop + 20,
            // Clear home indicator / Android nav with extra breathing room
            paddingBottom: safeBottom + 24,
            paddingHorizontal: sidePad,
          },
        ]}
      >
        {allowScroll ? (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              bounces={false}
            >
              {content}
            </ScrollView>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </>
        ) : (
          <>
            <View style={styles.flexShrink}>{content}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </>
        )}
      </View>
    </View>
  );
}

export function OnboardingBackButton() {
  return (
    <TouchableOpacity
      onPress={() => router.back()}
      style={styles.backBtn}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Back"
    >
      <Feather name="chevron-left" size={24} color={C.text} />
    </TouchableOpacity>
  );
}

export function OnboardingProgress({
  step,
  totalSteps = 6,
}: {
  step: number;
  totalSteps?: number;
}) {
  return (
    <View
      style={styles.progressWrap}
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${step} of ${totalSteps}`}
      accessibilityValue={{ min: 1, max: totalSteps, now: step }}
    >
      <View style={styles.progressTrack}>
        {Array.from({ length: totalSteps }, (_, i) => {
          const n = i + 1;
          const done = n < step;
          const current = n === step;
          return (
            <View
              key={n}
              style={[
                styles.progressSeg,
                {
                  backgroundColor: done ? C.cyan : current ? C.lime : "rgba(85,111,190,0.35)",
                },
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.progressLabel}>
        Step {step} of {totalSteps}
      </Text>
    </View>
  );
}

export function OnboardingMascot({
  source,
  accessibilityLabel,
}: {
  source: ImageSourcePropType;
  accessibilityLabel?: string;
}) {
  const { width, height } = useWindowDimensions();
  const compact = height < 740 || width < 360;
  const size = compact ? Math.min(148, width * 0.4) : Math.min(180, width * 0.42);

  return (
    <View style={[styles.mascotWrap, { height: size }]}>
      <View style={[styles.mascotGlow, { width: size * 0.75, height: size * 0.75 }]} />
      <Image
        source={source}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        accessibilityElementsHidden={!accessibilityLabel}
        importantForAccessibility={accessibilityLabel ? "yes" : "no-hide-descendants"}
      />
    </View>
  );
}

export function OnboardingPrimaryButton({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.primaryBtn, (disabled || loading) && { opacity: 0.5 }]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }}
    >
      <LinearGradient
        colors={[C.cyan, C.primary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.primaryBtnGrad}
      >
        <Text style={styles.primaryBtnText}>{loading ? "Please wait…" : label}</Text>
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function OnboardingSecondaryButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={{ top: 10, bottom: 10, left: 12, right: 12 }}
      style={styles.secondaryBtn}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.secondaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

export function OnboardingFeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  body: string;
}) {
  return (
    <View style={styles.featureCard}>
      <View style={styles.featureIcon}>
        <Feather name={icon} size={15} color={C.cyan} />
      </View>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.featureBody} numberOfLines={2}>
          {body}
        </Text>
      </View>
    </View>
  );
}

export function OnboardingOptionRow({
  title,
  recommended,
  selected,
  onPress,
}: {
  title: string;
  recommended?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.optionRow,
        selected && { borderColor: C.cyan, backgroundColor: "#20C7FF14" },
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={recommended ? `${title}, Recommended` : title}
    >
      <Text style={styles.optionTitle}>{title}</Text>
      {recommended ? (
        <View style={styles.recommendedBadge}>
          <Text style={styles.recommendedText}>Recommended</Text>
        </View>
      ) : null}
      <View style={{ flex: 1 }} />
      <View
        style={[
          styles.optionRadio,
          selected && { borderColor: C.lime, backgroundColor: C.lime },
        ]}
      >
        {selected ? <View style={styles.optionRadioDot} /> : null}
      </View>
    </TouchableOpacity>
  );
}

/** @deprecated Prefer OnboardingOptionRow for compact step-goal UI */
export function OnboardingOptionCard({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
  icon?: React.ComponentProps<typeof Feather>["name"];
}) {
  return (
    <OnboardingOptionRow
      title={title}
      recommended={subtitle === "Recommended"}
      selected={selected}
      onPress={onPress}
    />
  );
}

export function announceForAccessibility(message: string) {
  if (Platform.OS === "ios" || Platform.OS === "android") {
    AccessibilityInfo.announceForAccessibility?.(message);
  }
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  flexShrink: { flex: 1, minHeight: 0 },
  main: {
    flex: 1,
    width: "100%",
    alignSelf: "center",
    maxWidth: isTablet ? 560 : undefined,
  },
  topGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 220,
  },
  contentColumn: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    flexGrow: 1,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 8,
    marginTop: 4,
  },
  progressFlex: { flex: 1 },
  backPlaceholder: { width: 44 },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -8,
  },
  body: {
    flex: 1,
    minHeight: 0,
    gap: 8,
    justifyContent: "flex-start",
  },
  footer: {
    paddingTop: 12,
    paddingBottom: 4,
    gap: 4,
  },
  progressWrap: { gap: 5 },
  progressTrack: { flexDirection: "row", gap: 5 },
  progressSeg: { flex: 1, height: 4, borderRadius: 99 },
  progressLabel: {
    color: C.textSecondary,
    fontSize: rf(11),
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 4,
  },
  mascotWrap: {
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    width: "100%",
    flexShrink: 1,
  },
  mascotGlow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "#7C4DFF22",
  },
  primaryBtn: { borderRadius: 18, overflow: "hidden", minHeight: 54 },
  primaryBtnGrad: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryBtnText: { color: "#FFF", fontSize: rf(15), fontWeight: "800" },
  secondaryBtn: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { color: C.textSecondary, fontSize: rf(13.5), fontWeight: "700" },
  featureCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 12,
    paddingVertical: 10,
    maxHeight: 72,
    minHeight: 56,
  },
  featureIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.cyan + "18",
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1, gap: 2 },
  featureTitle: { color: C.text, fontSize: rf(15), fontWeight: "800" },
  featureBody: { color: C.textSecondary, fontSize: rf(12.5), lineHeight: rf(16) },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.border,
    backgroundColor: C.card,
    paddingHorizontal: 14,
    minHeight: 56,
    maxHeight: 64,
  },
  optionTitle: { color: C.text, fontSize: rf(15), fontWeight: "800" },
  recommendedBadge: {
    marginLeft: 8,
    borderRadius: 999,
    backgroundColor: C.lime + "22",
    borderWidth: 1,
    borderColor: C.lime + "66",
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  recommendedText: { color: C.lime, fontSize: rf(10.5), fontWeight: "800" },
  optionRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: C.border,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: "auto",
  },
  optionRadioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#070A18",
  },
});
