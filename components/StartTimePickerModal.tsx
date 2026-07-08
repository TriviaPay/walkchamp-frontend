import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";

const VISIBLE_ROWS = 5;

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

function formatTime12(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatWheelLabel(wheel: WheelValue): string {
  const min = String(wheel.minute).padStart(2, "0");
  const period = wheel.isPM ? "PM" : "AM";
  return `${wheel.hour12}:${min} ${period}`;
}

function wheelMinuteForDate(d: Date): number {
  return d.getMinutes() >= 30 ? 30 : 0;
}

function dateToWheel(d: Date, isNow: boolean): WheelValue {
  const h24 = d.getHours();
  return {
    isNow,
    hour12: h24 % 12 || 12,
    minute: wheelMinuteForDate(d),
    isPM: h24 >= 12,
  };
}

function presetToWheel(preset: TimePreset): WheelValue {
  if (preset.isNow) {
    return dateToWheel(new Date(), true);
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

function wheelToMinutes(wheel: WheelValue): number {
  return wheelToHour24(wheel.hour12, wheel.isPM) * 60 + wheel.minute;
}

/** Next strictly-future 30-min slot from the user's local clock (e.g. 1:02 → 1:30, 12:45 → 1:00). */
export function nextScheduledSlotFromNow(now = new Date()): WheelValue {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let nextMin = Math.ceil((nowMin + 1) / 30) * 30;
  if (nextMin >= 24 * 60) nextMin = 23 * 60 + 30;
  const hour24 = Math.floor(nextMin / 60);
  const minute = nextMin % 60;
  return {
    isNow: false,
    hour12: hour24 % 12 || 12,
    minute,
    isPM: hour24 >= 12,
  };
}

export function getNextPresetIndexForNow(presets: TimePreset[], now = new Date()): number {
  const slot = nextScheduledSlotFromNow(now);
  const hour24 = wheelToHour24(slot.hour12, slot.isPM);
  const idx = presets.findIndex((p) => !p.isNow && p.hour === hour24 && p.minute === slot.minute);
  if (idx >= 0) return idx;
  const nextMin = hour24 * 60 + slot.minute;
  const fallbackIdx = presets.findIndex((p) => !p.isNow && p.hour * 60 + p.minute >= nextMin);
  if (fallbackIdx >= 0) return fallbackIdx;
  const fallback = presets.findIndex((p) => !p.isNow);
  return fallback >= 0 ? fallback : 0;
}

export function getNextFutureWheel(_presets: TimePreset[], now = new Date()): WheelValue {
  return nextScheduledSlotFromNow(now);
}

function wheelToIndices(
  wheel: WheelValue,
  hours: string[],
  minutes: string[],
): { hour: number; minute: number; period: number } {
  return {
    hour: Math.max(0, hours.indexOf(String(wheel.hour12))),
    minute: Math.max(0, minutes.indexOf(wheel.minute === 30 ? "30" : "00")),
    period: wheel.isPM ? 1 : 0,
  };
}

export function clampWheelToFuture(
  wheel: WheelValue,
  presets: TimePreset[],
  isToday: boolean,
  now = new Date(),
): WheelValue {
  if (!isToday || wheel.isNow) return wheel;
  if (wheelToMinutes(wheel) > now.getHours() * 60 + now.getMinutes()) return wheel;
  return getNextFutureWheel(presets, now);
}

export function resolveInitialPresetIndex(
  presets: TimePreset[],
  selectedIndex: number,
  isToday: boolean,
  now = new Date(),
): number {
  if (!isToday) return Math.max(0, selectedIndex);
  const preset = presets[selectedIndex];
  if (preset?.isNow) return 0;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (!preset || preset.hour * 60 + preset.minute <= nowMin) {
    return getNextPresetIndexForNow(presets, now);
  }
  return selectedIndex;
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
  defaultIndex,
  onChange,
  onInteract,
  accent,
  width,
  itemH,
  pad,
  wheelBg,
  borderColor,
}: {
  items: string[];
  defaultIndex: number;
  onChange: (index: number) => void;
  onInteract?: () => void;
  accent: string;
  width: number;
  itemH: number;
  pad: number;
  wheelBg: string;
  borderColor: string;
}) {
  const colors = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const onChangeRef = useRef(onChange);
  const onInteractRef = useRef(onInteract);
  const startIndex = Math.max(0, Math.min(items.length - 1, defaultIndex));
  const activeIndexRef = useRef(startIndex);
  const [activeIndex, setActiveIndex] = useState(startIndex);
  const wheelH = itemH * VISIBLE_ROWS;

  onChangeRef.current = onChange;
  onInteractRef.current = onInteract;

  useEffect(() => {
    const y = startIndex * itemH;
    activeIndexRef.current = startIndex;
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ y, animated: false }));
    setActiveIndex(startIndex);
  }, [startIndex, itemH]);

  const snapScroll = useCallback((y: number) => {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(y / itemH)));
    const targetY = index * itemH;
    if (Math.abs(y - targetY) > 1) {
      scrollRef.current?.scrollTo({ y: targetY, animated: true });
    }
    const changed = index !== activeIndexRef.current;
    activeIndexRef.current = index;
    setActiveIndex(index);
    onChangeRef.current(index);
    if (changed) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [itemH, items.length]);

  const onScroll = useCallback((y: number) => {
    const index = Math.max(0, Math.min(items.length - 1, Math.round(y / itemH)));
    setActiveIndex(index);
  }, [itemH, items.length]);

  return (
    <View style={{ width, height: wheelH }}>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: pad,
          left: 0,
          right: 0,
          height: itemH,
          borderRadius: rs(10),
          backgroundColor: "transparent",
          borderWidth: 1.5,
          borderColor: accent + "90",
          zIndex: 1,
        }}
      />
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, zIndex: 2 }}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemH}
        snapToAlignment="start"
        decelerationRate="fast"
        nestedScrollEnabled
        scrollEventThrottle={16}
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={{ paddingVertical: pad }}
        onScrollBeginDrag={() => onInteractRef.current?.()}
        onScroll={(e) => onScroll(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => snapScroll(e.nativeEvent.contentOffset.y)}
        onMomentumScrollEnd={(e) => snapScroll(e.nativeEvent.contentOffset.y)}
      >
        {items.map((label, i) => {
          const dist = Math.abs(i - activeIndex);
          const isSelected = dist === 0;
          return (
            <View
              key={`${label}-${i}`}
              style={{ height: itemH, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{
                fontSize: isSelected ? rf(20) : rf(16),
                fontWeight: isSelected ? "800" : "500",
                color: isSelected ? colors.foreground : colors.mutedForeground,
                opacity: isSelected ? 1 : dist === 1 ? 0.55 : 0.3,
              }}>
                {label}
              </Text>
            </View>
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
  const itemH = useMemo(() => Math.round(rs(38)), []);
  const pad = useMemo(() => Math.floor(VISIBLE_ROWS / 2) * itemH, [itemH]);
  const wheelH = itemH * VISIBLE_ROWS;
  const hours = useMemo(() => Array.from({ length: 12 }, (_, i) => String(i + 1)), []);
  const minutes = useMemo(() => ["00", "30"], []);
  const periods = useMemo(() => ["AM", "PM"], []);

  const [draft, setDraft] = useState<WheelValue>(() =>
    presetToWheel(getPresetForIndex(presets, selectedIndex)),
  );
  const [wheelSeed, setWheelSeed] = useState<WheelValue>(() =>
    presetToWheel(getPresetForIndex(presets, selectedIndex)),
  );
  const [wheelEpoch, setWheelEpoch] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  const [segW, setSegW] = useState(0);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Sliding highlight for the Now / Schedule segmented control.
  const segAnim = useRef(new Animated.Value(draft.isNow ? 0 : 1)).current;
  useEffect(() => {
    Animated.timing(segAnim, {
      toValue: draft.isNow ? 0 : 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [draft.isNow, segAnim]);

  const applyWheel = useCallback((wheel: WheelValue) => {
    draftRef.current = wheel;
    setWheelSeed(wheel);
    setDraft(wheel);
    setWheelEpoch((n) => n + 1);
    setError(null);
  }, []);

  // True when a scheduled (non-"Now") time on today's date is already in the past.
  const isPastWheel = useCallback((wheel: WheelValue, now = new Date()): boolean => {
    if (!isToday || wheel.isNow) return false;
    return wheelToMinutes(wheel) <= now.getHours() * 60 + now.getMinutes();
  }, [isToday]);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    const resolvedIdx = resolveInitialPresetIndex(presets, selectedIndex, isToday);
    const preset = getPresetForIndex(presets, resolvedIdx);
    const wheel = presetToWheel(preset);
    applyWheel(wheel);
  }, [visible, isToday, presets, selectedIndex, applyWheel]);

  useEffect(() => {
    if (!visible || !draft.isNow || !isToday) return;
    const id = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, [visible, draft.isNow, isToday]);

  const liveNow = useMemo(() => new Date(nowTick), [nowTick]);

  const { hour: hourIndex, minute: minuteIndex, period: periodIndex } = useMemo(
    () => wheelToIndices(wheelSeed, hours, minutes),
    [wheelSeed, hours, minutes],
  );

  const displayLabel = draft.isNow && isToday
    ? formatTime12(liveNow)
    : formatWheelLabel(draft);

  const wheelBg = colors.background;

  const selectNow = useCallback(() => {
    applyWheel(dateToWheel(new Date(), true));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [applyWheel]);

  const switchToScheduled = useCallback(() => {
    applyWheel(getNextFutureWheel(presets, new Date()));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [presets, applyWheel]);

  const onWheelInteract = useCallback(() => {
    setError(null);
    if (!draftRef.current.isNow) return;
    const next = getNextFutureWheel(presets, new Date());
    draftRef.current = next;
    setDraft(next);
  }, [presets]);

  const onHourChange = useCallback((i: number) => {
    const next = { ...draftRef.current, isNow: false, hour12: i + 1 };
    draftRef.current = next;
    setDraft(next);
    setError(null);
  }, []);

  const onMinuteChange = useCallback((i: number) => {
    const next = { ...draftRef.current, isNow: false, minute: i === 1 ? 30 : 0 };
    draftRef.current = next;
    setDraft(next);
    setError(null);
  }, []);

  const onPeriodChange = useCallback((i: number) => {
    const next = { ...draftRef.current, isNow: false, isPM: i === 1 };
    draftRef.current = next;
    setDraft(next);
    setError(null);
  }, []);

  const handleConfirm = useCallback(() => {
    const currentDraft = draftRef.current;
    // Block scheduling a time that has already passed today.
    if (isPastWheel(currentDraft)) {
      setError("The selected time has already passed. Please choose a future date and time.");
      void Haptics.notificationAsync?.(Haptics.NotificationFeedbackType?.Error);
      return;
    }
    setError(null);
    onConfirm(findPresetIndex(presets, currentDraft, isToday));
    onClose();
  }, [isToday, presets, onConfirm, onClose, isPastWheel]);

  const handleDismissApply = useCallback(() => {
    // Tapping outside on an invalid past time simply cancels (never saves a past time).
    if (isPastWheel(draftRef.current)) {
      onClose();
      return;
    }
    handleConfirm();
  }, [handleConfirm, isPastWheel, onClose]);

  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  const showWheels = !isToday || !draft.isNow;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDismissApply}>
      <View
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", alignItems: "center", padding: rs(20) }}
      >
        <Pressable
          style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }}
          onPress={handleDismissApply}
        />
        <View style={{ width: "100%", maxWidth: 300, zIndex: 1 }}>
          <View style={{
            backgroundColor: colors.card,
            borderRadius: rs(18),
            borderWidth: 1,
            borderColor: colors.border,
            overflow: "hidden",
            paddingBottom: rs(14),
          }}>
            <Text style={{
              fontSize: rf(16),
              fontWeight: "700",
              color: colors.foreground,
              textAlign: "center",
              paddingVertical: rs(14),
            }}>
              Select Start Time
            </Text>

            {isToday && (
              <View
                onLayout={(e) => setSegW(e.nativeEvent.layout.width)}
                style={{
                  marginHorizontal: rs(16),
                  marginBottom: rs(12),
                  height: rs(46),
                  borderRadius: rs(13),
                  backgroundColor: colors.background,
                  borderWidth: 1,
                  borderColor: colors.border,
                  flexDirection: "row",
                  padding: rs(4),
                }}
              >
                {segW > 0 && (
                  <Animated.View
                    style={{
                      position: "absolute",
                      top: rs(4),
                      left: rs(4),
                      bottom: rs(4),
                      width: (segW - rs(8)) / 2,
                      borderRadius: rs(10),
                      backgroundColor: accent,
                      transform: [{
                        translateX: segAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: [0, (segW - rs(8)) / 2],
                        }),
                      }],
                    }}
                  />
                )}
                <TouchableOpacity
                  onPress={selectNow}
                  activeOpacity={0.8}
                  style={{ flex: 1, alignItems: "center", justifyContent: "center", zIndex: 1 }}
                >
                  <Text style={{ fontSize: rf(13.5), fontWeight: "800", color: draft.isNow ? "#000" : colors.foreground }}>
                    Now
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={switchToScheduled}
                  activeOpacity={0.8}
                  style={{ flex: 1, alignItems: "center", justifyContent: "center", zIndex: 1 }}
                >
                  <Text style={{ fontSize: rf(13.5), fontWeight: "800", color: !draft.isNow ? "#000" : colors.foreground }}>
                    Schedule
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={{
              fontSize: rf(30),
              fontWeight: "800",
              color: accent,
              textAlign: "center",
              marginBottom: rs(4),
              letterSpacing: 0.3,
            }}>
              {displayLabel}
            </Text>

            <Text style={{
              fontSize: rf(11.5),
              color: colors.mutedForeground,
              textAlign: "center",
              marginBottom: rs(12),
            }}>
              {draft.isNow && isToday ? "Starts right away" : "Scheduled start time"}
            </Text>

            {showWheels ? (
              <View style={{ height: wheelH, marginHorizontal: rs(16), marginBottom: rs(6) }}>
                <View style={{ flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center" }}>
                  <WheelColumn
                    key={`h-${wheelEpoch}`}
                    items={hours}
                    defaultIndex={hourIndex}
                    onChange={onHourChange}
                    onInteract={onWheelInteract}
                    accent={accent}
                    width={rs(64)}
                    itemH={itemH}
                    pad={pad}
                    wheelBg={wheelBg}
                    borderColor={colors.border}
                  />
                  <Text style={{
                    fontSize: rf(22),
                    fontWeight: "800",
                    color: accent,
                    width: rs(16),
                    textAlign: "center",
                    marginTop: -2,
                  }}>
                    :
                  </Text>
                  <WheelColumn
                    key={`m-${wheelEpoch}`}
                    items={minutes}
                    defaultIndex={minuteIndex}
                    onChange={onMinuteChange}
                    onInteract={onWheelInteract}
                    accent={accent}
                    width={rs(64)}
                    itemH={itemH}
                    pad={pad}
                    wheelBg={wheelBg}
                    borderColor={colors.border}
                  />
                  <WheelColumn
                    key={`p-${wheelEpoch}`}
                    items={periods}
                    defaultIndex={periodIndex}
                    onChange={onPeriodChange}
                    onInteract={onWheelInteract}
                    accent={accent}
                    width={rs(64)}
                    itemH={itemH}
                    pad={pad}
                    wheelBg={wheelBg}
                    borderColor={colors.border}
                  />
                </View>
              </View>
            ) : (
              <View style={{ marginBottom: rs(6) }} />
            )}

            {error && (
              <View style={{
                marginHorizontal: rs(16),
                marginBottom: rs(10),
                paddingVertical: rs(9),
                paddingHorizontal: rs(12),
                borderRadius: rs(10),
                backgroundColor: "#FF3B3018",
                borderWidth: 1,
                borderColor: "#FF3B3055",
              }}>
                <Text style={{ fontSize: rf(12), fontWeight: "600", color: "#FF5A50", textAlign: "center" }}>
                  {error}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: "row", gap: rs(10), paddingHorizontal: rs(16), paddingTop: rs(4) }}>
              <TouchableOpacity
                style={{
                  flex: 1,
                  paddingVertical: rs(13),
                  borderRadius: rs(12),
                  borderWidth: 1.5,
                  borderColor: accent + "80",
                  alignItems: "center",
                }}
                onPress={handleCancel}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: rf(14), fontWeight: "700", color: colors.foreground }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: rs(13), borderRadius: rs(12), backgroundColor: accent, alignItems: "center" }}
                onPress={handleConfirm}
                activeOpacity={0.8}
              >
                <Text style={{ fontSize: rf(14), fontWeight: "800", color: "#000" }}>Set</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
