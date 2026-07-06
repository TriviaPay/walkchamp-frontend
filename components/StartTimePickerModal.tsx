import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";

const ITEM_H = rs(32);
const VISIBLE_ROWS = 3;
const WHEEL_H = ITEM_H * VISIBLE_ROWS;

export interface TimePreset {
  label: string;
  hour: number;
  minute: number;
  isNow?: boolean;
}

interface WheelValue {
  isNow: boolean;
  hour12: number;
  minute: number;
  isPM: boolean;
}

function presetToWheel(preset: TimePreset): WheelValue {
  if (preset.isNow) {
    const now = new Date();
    const h24 = now.getHours();
    return {
      isNow: true,
      hour12: h24 % 12 || 12,
      minute: now.getMinutes() >= 30 ? 30 : 0,
      isPM: h24 >= 12,
    };
  }
  const h24 = preset.hour;
  return {
    isNow: false,
    hour12: h24 % 12 || 12,
    minute: preset.minute,
    isPM: h24 >= 12,
  };
}

function wheelToHour24(hour12: number, isPM: boolean): number {
  if (hour12 === 12) return isPM ? 12 : 0;
  return isPM ? hour12 + 12 : hour12;
}

export function findPresetIndex(
  presets: TimePreset[],
  wheel: WheelValue,
  isToday: boolean,
): number {
  if (wheel.isNow && isToday) {
    const nowIdx = presets.findIndex((p) => p.isNow);
    return nowIdx >= 0 ? nowIdx : 0;
  }
  const hour24 = wheelToHour24(wheel.hour12, wheel.isPM);
  const idx = presets.findIndex((p) => !p.isNow && p.hour === hour24 && p.minute === wheel.minute);
  if (idx >= 0) return idx;
  const fallback = presets.findIndex((p) => !p.isNow);
  return fallback >= 0 ? fallback : 0;
}

export function getPresetForIndex(
  presets: TimePreset[],
  timeIdx: number,
): TimePreset {
  return presets[timeIdx] ?? presets[0]!;
}

function WheelColumn({
  items,
  selectedIndex,
  onChange,
  accent,
  width,
}: {
  items: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
  accent: string;
  width: number;
}) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const pad = Math.floor(VISIBLE_ROWS / 2) * ITEM_H;

  const scrollToIndex = useCallback((index: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ y: index * ITEM_H, animated });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => scrollToIndex(selectedIndex, false), 50);
    return () => clearTimeout(t);
  }, [selectedIndex, scrollToIndex]);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.y / ITEM_H)));
    if (index !== selectedIndex) {
      onChange(index);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    scrollToIndex(index, true);
  };

  return (
    <View style={{ width, height: WHEEL_H, overflow: "hidden" }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: pad,
          left: 2,
          right: 2,
          height: ITEM_H,
          borderRadius: rs(8),
          backgroundColor: accent + "18",
          borderWidth: 1,
          borderColor: accent + "45",
          zIndex: 2,
        }}
      />
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={ITEM_H}
        decelerationRate="fast"
        nestedScrollEnabled
        contentContainerStyle={{ paddingVertical: pad }}
        onMomentumScrollEnd={onScrollEnd}
        onScrollEndDrag={onScrollEnd}
      >
        {items.map((label, i) => {
          const dist = Math.abs(i - selectedIndex);
          return (
            <TouchableOpacity
              key={`${label}-${i}`}
              activeOpacity={0.8}
              onPress={() => {
                onChange(i);
                scrollToIndex(i, true);
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{ height: ITEM_H, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{
                fontSize: dist === 0 ? rf(16) : rf(13),
                fontWeight: dist === 0 ? "800" : "500",
                color: dist === 0 ? accent : colors.mutedForeground,
                opacity: dist === 0 ? 1 : dist === 1 ? 0.75 : 0.45,
              }}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

export default function StartTimePickerModal({
  visible,
  accent,
  isToday,
  presets,
  selectedIndex,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  accent: string;
  isToday: boolean;
  presets: TimePreset[];
  selectedIndex: number;
  onClose: () => void;
  onConfirm: (index: number) => void;
}) {
  const colors = useColors();
  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const minutes = ["00", "30"];
  const periods = ["AM", "PM"];

  const [draft, setDraft] = useState<WheelValue>(() => presetToWheel(getPresetForIndex(presets, selectedIndex)));

  useEffect(() => {
    if (!visible) return;
    setDraft(presetToWheel(getPresetForIndex(presets, selectedIndex)));
  }, [visible, selectedIndex, presets]);

  const hourIndex = Math.max(0, hours.indexOf(String(draft.hour12)));
  const minuteIndex = Math.max(0, minutes.indexOf(draft.minute === 30 ? "30" : "00"));
  const periodIndex = draft.isPM ? 1 : 0;

  const displayLabel = draft.isNow && isToday
    ? "Now"
    : `${draft.hour12}:${minutes[minuteIndex]} ${periods[periodIndex]}`;

  const handleConfirm = () => {
    onConfirm(findPresetIndex(presets, draft, isToday));
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: rs(32) }}
        onPress={onClose}
      >
        <Pressable onPress={() => {}} style={{ width: "100%", maxWidth: 260 }}>
          <View style={{
            backgroundColor: colors.card,
            borderRadius: rs(16),
            borderWidth: 1,
            borderColor: colors.border,
            overflow: "hidden",
            paddingBottom: rs(10),
          }}>
            <Text style={{
              fontSize: rf(14),
              fontWeight: "700",
              color: colors.foreground,
              textAlign: "center",
              paddingVertical: rs(10),
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}>
              Select Start Time
            </Text>

            {isToday && (
              <TouchableOpacity
                onPress={() => setDraft((prev) => ({ ...prev, isNow: !prev.isNow }))}
                activeOpacity={0.8}
                style={{
                  marginHorizontal: rs(12),
                  marginTop: rs(8),
                  marginBottom: rs(4),
                  paddingVertical: rs(7),
                  borderRadius: rs(10),
                  borderWidth: 1.5,
                  borderColor: draft.isNow ? accent : colors.border,
                  backgroundColor: draft.isNow ? accent + "16" : colors.background,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontSize: rf(13), fontWeight: "800", color: draft.isNow ? accent : colors.foreground }}>Now</Text>
              </TouchableOpacity>
            )}

            <Text style={{ fontSize: rf(18), fontWeight: "800", color: accent, textAlign: "center", marginVertical: rs(6) }}>
              {displayLabel}
            </Text>

            <View style={{ flexDirection: "row", justifyContent: "center", opacity: draft.isNow && isToday ? 0.35 : 1 }} pointerEvents={draft.isNow && isToday ? "none" : "auto"}>
              <WheelColumn
                items={hours}
                selectedIndex={hourIndex}
                onChange={(i) => setDraft((prev) => ({ ...prev, isNow: false, hour12: i + 1 }))}
                accent={accent}
                width={rs(52)}
              />
              <Text style={{ fontSize: rf(16), fontWeight: "800", color: colors.foreground, alignSelf: "center", marginHorizontal: rs(2) }}>:</Text>
              <WheelColumn
                items={minutes}
                selectedIndex={minuteIndex}
                onChange={(i) => setDraft((prev) => ({ ...prev, isNow: false, minute: i === 1 ? 30 : 0 }))}
                accent={accent}
                width={rs(52)}
              />
              <WheelColumn
                items={periods}
                selectedIndex={periodIndex}
                onChange={(i) => setDraft((prev) => ({ ...prev, isNow: false, isPM: i === 1 }))}
                accent={accent}
                width={rs(52)}
              />
            </View>

            <View style={{ flexDirection: "row", gap: rs(8), paddingHorizontal: rs(12), paddingTop: rs(8) }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: rs(9), borderRadius: rs(10), borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                onPress={onClose}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: rf(12), fontWeight: "700", color: colors.mutedForeground }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: rs(9), borderRadius: rs(10), backgroundColor: accent, alignItems: "center" }}
                onPress={handleConfirm}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: rf(12), fontWeight: "800", color: "#000" }}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
