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
  valueLabel,
  minLabel,
  maxLabel,
  badge,
}: {
  options: number[];
  value: number;
  onChange: (v: number) => void;
  accent: string;
  valueLabel: string;
  minLabel: string;
  maxLabel: string;
  badge?: { title: string; subtitle: string } | null;
}) {
  const colors = useColors();
  const [trackW, setTrackW] = useState(0);
  const idxRef = useRef(Math.max(0, options.indexOf(value)));
  const [idx, setIdx] = useState(idxRef.current);

  useEffect(() => {
    const nextIdx = Math.max(0, options.indexOf(value));
    idxRef.current = nextIdx;
    setIdx(nextIdx);
  }, [value, options]);

  const maxIdx = Math.max(1, options.length - 1);
  const ratio = idx / maxIdx;
  const thumbOffset = trackW > 0 ? ratio * Math.max(0, trackW - THUMB_SIZE) : 0;
  const fillWidth = trackW > 0 ? thumbOffset + THUMB_SIZE / 2 : 0;

  const applyIndex = useCallback((nextIdx: number) => {
    const clamped = Math.max(0, Math.min(nextIdx, options.length - 1));
    if (clamped === idxRef.current) return;
    idxRef.current = clamped;
    setIdx(clamped);
    onChange(options[clamped]!);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [onChange, options]);

  const applyFromX = useCallback((x: number) => {
    if (trackW <= 0) return;
    const clampedX = Math.max(0, Math.min(x, trackW));
    const nextIdx = Math.round((clampedX / trackW) * maxIdx);
    applyIndex(nextIdx);
  }, [applyIndex, maxIdx, trackW]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => applyFromX(evt.nativeEvent.locationX),
    onPanResponderMove: (evt) => applyFromX(evt.nativeEvent.locationX),
  }), [applyFromX]);

  const onTrackLayout = (e: LayoutChangeEvent) => {
    setTrackW(e.nativeEvent.layout.width);
  };

  return (
    <View style={{ paddingHorizontal: rs(20), paddingTop: rs(8), paddingBottom: rs(12), gap: rs(14) }}>
      <Text style={{ fontSize: rf(28), fontWeight: "800", color: accent, textAlign: "center", letterSpacing: 0.2 }}>
        {valueLabel}
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
