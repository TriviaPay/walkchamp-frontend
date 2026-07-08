import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, View, Text, type LayoutChangeEvent } from "react-native";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";

const THUMB_SIZE = rs(26);

export default function DiscreteSliderPicker({
  options,
  value,
  onChange,
  accent,
  formatLabel,
  minLabel,
  maxLabel,
  badge,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
  accent: string;
  formatLabel: (v: number) => string;
  minLabel: string;
  maxLabel: string;
  badge?: { title: string; subtitle: string } | null;
}) {
  const colors = useColors();
  const [trackW, setTrackW] = useState(0);
  const idxRef = useRef(Math.max(0, options.indexOf(value)));
  const [idx, setIdx] = useState(idxRef.current);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const draggingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (draggingRef.current) return;
    const nextIdx = Math.max(0, options.indexOf(value));
    idxRef.current = nextIdx;
    setIdx(nextIdx);
  }, [value, options]);

  const maxIdx = Math.max(1, options.length - 1);
  const snappedRatio = idx / maxIdx;
  const displayRatio = dragRatio ?? snappedRatio;
  const thumbOffset = trackW > 0 ? displayRatio * Math.max(0, trackW - THUMB_SIZE) : 0;
  const fillWidth = trackW > 0 ? thumbOffset + THUMB_SIZE / 2 : 0;
  const previewIdx = dragRatio != null
    ? Math.max(0, Math.min(Math.round(dragRatio * maxIdx), options.length - 1))
    : idx;
  const displayValue = options[previewIdx] ?? value;

  const applyIndex = useCallback((nextIdx: number, fireHaptic: boolean) => {
    const clamped = Math.max(0, Math.min(nextIdx, options.length - 1));
    const changed = clamped !== idxRef.current;
    idxRef.current = clamped;
    setIdx(clamped);
    onChangeRef.current(options[clamped]!);
    if (changed && fireHaptic) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [options]);

  const ratioFromX = useCallback((x: number) => {
    if (trackW <= 0) return 0;
    const clampedX = Math.max(0, Math.min(x, trackW));
    return clampedX / trackW;
  }, [trackW]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gestureState) =>
      Math.abs(gestureState.dx) > Math.abs(gestureState.dy),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      draggingRef.current = true;
      setDragRatio(ratioFromX(evt.nativeEvent.locationX));
    },
    onPanResponderMove: (evt) => {
      const ratio = ratioFromX(evt.nativeEvent.locationX);
      setDragRatio(ratio);
      const nextIdx = Math.round(ratio * maxIdx);
      if (nextIdx !== idxRef.current) {
        applyIndex(nextIdx, true);
      }
    },
    onPanResponderRelease: (evt) => {
      const ratio = ratioFromX(evt.nativeEvent.locationX);
      const nextIdx = Math.round(ratio * maxIdx);
      draggingRef.current = false;
      setDragRatio(null);
      applyIndex(nextIdx, true);
    },
    onPanResponderTerminate: (evt) => {
      const ratio = ratioFromX(evt.nativeEvent.locationX);
      const nextIdx = Math.round(ratio * maxIdx);
      draggingRef.current = false;
      setDragRatio(null);
      applyIndex(nextIdx, false);
    },
  }), [applyIndex, maxIdx, ratioFromX]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackW(e.nativeEvent.layout.width);
  };

  return (
    <View style={{ paddingHorizontal: rs(20), paddingTop: rs(8), paddingBottom: rs(12), gap: rs(14) }}>
      <Text style={{ fontSize: rf(28), fontWeight: "800", color: accent, textAlign: "center", letterSpacing: 0.2 }}>
        {formatLabel(displayValue)}
      </Text>

      {badge ? (
        <View style={{ alignItems: "center", gap: rs(6) }}>
          <View style={{
            paddingHorizontal: rs(10),
            paddingVertical: rs(4),
            borderRadius: rs(8),
            backgroundColor: "#F59E0B22",
            borderWidth: 1,
            borderColor: "#F59E0B66",
          }}>
            <Text style={{ fontSize: rf(11), fontWeight: "800", color: "#F59E0B", letterSpacing: 0.6 }}>
              {badge.title}
            </Text>
          </View>
          <Text style={{ fontSize: rf(11), color: colors.mutedForeground, textAlign: "center" }}>
            {badge.subtitle}
          </Text>
        </View>
      ) : null}

      <View
        onLayout={onTrackLayout}
        style={{ height: rs(44), justifyContent: "center" }}
        {...panResponder.panHandlers}
      >
        <View style={{
          height: rs(6),
          borderRadius: rs(3),
          backgroundColor: colors.border,
          overflow: "hidden",
        }}>
          <View style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: fillWidth,
            backgroundColor: accent + "CC",
            borderRadius: rs(3),
          }} />
        </View>
        <View style={{
          position: "absolute",
          left: thumbOffset,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          borderRadius: THUMB_SIZE / 2,
          backgroundColor: accent,
          borderWidth: 2,
          borderColor: "#FFFFFF",
          shadowColor: accent,
          shadowOpacity: 0.45,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        }} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text style={{ fontSize: rf(10), color: colors.mutedForeground, flex: 1 }}>
          {minLabel}
        </Text>
        <Text style={{ fontSize: rf(10), color: colors.mutedForeground, textAlign: "right", flex: 1 }}>
          {maxLabel}
        </Text>
      </View>
    </View>
  );
}
