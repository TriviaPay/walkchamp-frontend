import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";

export type AvatarPickerOption = {
  label: string;
  icon: string;
  destructive?: boolean;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  options: AvatarPickerOption[];
};

// Slide-in duration for the sheet coming up
const ANIM_IN_MS  = 260;
// Slide-out duration for the sheet going down
const ANIM_OUT_MS = 200;
// Extra wait after the sheet has finished sliding out before launching
// the system picker.
//
// iOS requires a generous delay because:
//   1. The system image picker (PHPickerViewController) must be presented from
//      the top-most UIViewController.  If our sheet is inside a parent Modal
//      (e.g. the walk-tab ProfileModal), iOS needs the view hierarchy to fully
//      settle before accepting a new presentation request.
//   2. With New Architecture (Fabric) the JS→native animation callbacks are
//      not always synchronised with the native layout pass, so the "animation
//      finished" signal can fire slightly earlier than iOS considers the
//      transition complete.
//   400 ms was empirically proven to work reliably (modal + 400 ms approach).
//   We use 250 ms here (200 ms animation + 250 ms buffer = 450 ms total) to
//   comfortably exceed that threshold while staying imperceptible to the user.
//
// Android: 50 ms is enough to yield one JS frame so state propagates.
const PICKER_DELAY_IOS     = 250;
const PICKER_DELAY_ANDROID = 50;

/**
 * A custom animated bottom sheet that replaces React Native's Modal.
 *
 * Why not Modal?
 *  - On iOS with newArchEnabled (Fabric), Modal.onDismiss fires unreliably.
 *  - Stacking a Modal inside another Modal (e.g. walk tab's profile sheet)
 *    is unsupported on iOS and causes the inner modal to never present.
 *  - Modal's visible=false→true recycling is buggy on RN 0.76+ new arch,
 *    causing "works once, breaks on second open" behaviour.
 *
 * This component uses Animated.View + absoluteFill so it works reliably
 * inside any parent including another Modal, KeyboardAvoidingView, etc.
 */
export function AvatarPickerSheet({ visible, onClose, options }: Props) {
  const colors = useColors();

  // Controls whether we render anything at all (kept true during exit anim)
  const [rendered, setRendered] = useState(false);

  // 0 = fully hidden (sheet off-bottom, backdrop transparent)
  // 1 = fully visible
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: ANIM_IN_MS,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: ANIM_OUT_MS,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setRendered(false);
      });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOptionPress = (onPress: () => void) => {
    // Close the sheet first (starts the slide-out animation)
    onClose();
    // Wait for the animation to fully complete before asking iOS/Android to
    // present the system picker.  Presenting a system sheet while our own
    // animation is still in flight causes iOS to silently drop the request.
    const delay = ANIM_OUT_MS + (Platform.OS === "ios" ? PICKER_DELAY_IOS : PICKER_DELAY_ANDROID);
    setTimeout(onPress, delay);
  };

  if (!rendered) return null;

  const backdropOpacity = progress;
  const sheetTranslateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [380, 0],
  });

  return (
    // box-none so taps on the transparent gap above the sheet still reach the
    // backdrop Pressable, but the container itself doesn't eat events.
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
        <Pressable style={styles.backdrop} onPress={onClose} />
      </Animated.View>

      {/* Sheet */}
      <Animated.View
        style={[
          styles.sheet,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            transform: [{ translateY: sheetTranslateY }],
          },
        ]}
      >
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text style={[styles.title, { color: colors.mutedForeground }]}>Profile Photo</Text>

        <View style={[styles.optionList, { borderColor: colors.border }]}>
          {options.map((opt, i) => (
            <TouchableOpacity
              key={i}
              style={[
                styles.option,
                { borderColor: colors.border },
                i < options.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth },
              ]}
              onPress={() => handleOptionPress(opt.onPress)}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconWrap,
                  {
                    backgroundColor:
                      (opt.destructive ? colors.warning : colors.primary) + "18",
                  },
                ]}
              >
                <Feather
                  name={opt.icon as "camera"}
                  size={18}
                  color={opt.destructive ? colors.warning : colors.primary}
                />
              </View>
              <Text
                style={[
                  styles.optionText,
                  { color: opt.destructive ? colors.warning : colors.foreground },
                ]}
              >
                {opt.label}
              </Text>
              <Feather
                name="chevron-right"
                size={16}
                color={colors.mutedForeground}
                style={{ opacity: 0.5 }}
              />
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.cancelBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={[styles.cancelText, { color: colors.foreground }]}>Cancel</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    paddingBottom: 48,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 18,
  },
  title: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  optionList: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    marginBottom: 10,
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  optionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
  },
  cancelBtn: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 15,
    alignItems: "center",
  },
  cancelText: {
    fontSize: 16,
    fontWeight: "600",
  },
});
