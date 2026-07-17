import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";
import {
  isDobFieldsFilled,
  normalizeDayInput,
  normalizeMonthInput,
  normalizeYearInput,
  parseDateOfBirth,
} from "@/utils/dateOfBirth";

interface Props {
  value: string;
  onChange: (val: string) => void;
}

export function DateOfBirthInput({ value, onChange }: Props) {
  const colors = useColors();

  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");

  const yearRef = useRef<TextInput>(null);
  const monthRef = useRef<TextInput>(null);
  const dayRef = useRef<TextInput>(null);

  useEffect(() => {
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-");
      setYear(y);
      // Keep display as stored digits (may be zero-padded from API).
      setMonth(m);
      setDay(d);
    }
  }, []);

  /**
   * Emit ISO YYYY-MM-DD when year + day + month form a real calendar date.
   * Accepts single-digit month/day (5 / 8 → 1993-05-08).
   * Clears parent while incomplete or definitely invalid so submit still shows required.
   */
  function notify(y: string, m: string, d: string) {
    const parsed = parseDateOfBirth(d, m, y);
    if (parsed.ok) {
      onChange(parsed.iso);
    } else {
      onChange("");
    }
  }

  function handleYear(text: string) {
    const clean = normalizeYearInput(text);
    setYear(clean);
    notify(clean, month, day);
    if (clean.length === 4) monthRef.current?.focus();
  }

  function handleMonth(text: string) {
    const clean = normalizeMonthInput(text);
    // Reject impossible mid-entry only when two digits and out of range (e.g. 13).
    if (clean.length === 2) {
      const n = Number(clean);
      if (n < 1 || n > 12) {
        setMonth(clean.slice(0, 1));
        notify(year, clean.slice(0, 1), day);
        return;
      }
    }
    setMonth(clean);
    notify(year, clean, day);
    if (clean.length === 2) dayRef.current?.focus();
  }

  function handleDay(text: string) {
    const clean = normalizeDayInput(text);
    if (clean.length === 2) {
      const n = Number(clean);
      if (n < 1 || n > 31) {
        setDay(clean.slice(0, 1));
        notify(year, month, clean.slice(0, 1));
        return;
      }
    }
    setDay(clean);
    notify(year, month, clean);
  }

  const filled = isDobFieldsFilled(year, month, day);

  return (
    <View
      style={[
        s.wrapper,
        {
          backgroundColor: colors.card,
          borderColor: filled ? colors.primary + "60" : colors.border,
        },
      ]}
    >
      <Feather name="calendar" size={18} color={colors.mutedForeground} />

      {/* ── Year ── */}
      <View style={s.seg}>
        <TextInput
          ref={yearRef}
          value={year}
          onChangeText={handleYear}
          keyboardType="number-pad"
          maxLength={4}
          placeholder="YYYY"
          placeholderTextColor={colors.mutedForeground + "70"}
          style={[s.segInput, { color: year ? colors.foreground : colors.mutedForeground }]}
          returnKeyType="next"
          onSubmitEditing={() => monthRef.current?.focus()}
        />
        <Text style={[s.segLabel, { color: colors.mutedForeground }]}>Year</Text>
      </View>

      <Text style={[s.divider, { color: colors.mutedForeground }]}>–</Text>

      {/* ── Month ── */}
      <View style={s.seg}>
        <TextInput
          ref={monthRef}
          value={month}
          onChangeText={handleMonth}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="MM"
          placeholderTextColor={colors.mutedForeground + "70"}
          style={[s.segInput, { color: month ? colors.foreground : colors.mutedForeground }]}
          returnKeyType="next"
          onSubmitEditing={() => dayRef.current?.focus()}
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === "Backspace" && month === "") yearRef.current?.focus();
          }}
        />
        <Text style={[s.segLabel, { color: colors.mutedForeground }]}>Month</Text>
      </View>

      <Text style={[s.divider, { color: colors.mutedForeground }]}>–</Text>

      {/* ── Day ── */}
      <View style={s.seg}>
        <TextInput
          ref={dayRef}
          value={day}
          onChangeText={handleDay}
          keyboardType="number-pad"
          maxLength={2}
          placeholder="DD"
          placeholderTextColor={colors.mutedForeground + "70"}
          style={[s.segInput, { color: day ? colors.foreground : colors.mutedForeground }]}
          returnKeyType="done"
          onKeyPress={({ nativeEvent }) => {
            if (nativeEvent.key === "Backspace" && day === "") monthRef.current?.focus();
          }}
        />
        <Text style={[s.segLabel, { color: colors.mutedForeground }]}>Day</Text>
      </View>

      {filled && (
        <Feather name="check-circle" size={18} color="#00E676" style={{ marginLeft: 4 }} />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: rs(14),
    paddingVertical: rs(10),
  },
  seg: {
    flex: 1,
    alignItems: "center",
  },
  segInput: {
    fontSize: rf(17),
    fontWeight: "700",
    textAlign: "center",
    paddingVertical: rs(4),
    width: "100%",
  },
  segLabel: {
    fontSize: rf(10),
    fontWeight: "600",
    marginTop: 2,
    letterSpacing: 0.4,
  },
  divider: {
    fontSize: rf(20),
    fontWeight: "300",
    opacity: 0.5,
    marginBottom: 14,
  },
});
