import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useTitleUnlock } from "@/context/TitleUnlockContext";
import { TitleBadge } from "@/components/TitleBadge";
import { useColors } from "@/hooks/useColors";

function difficultyColor(d: string): string {
  switch (d) {
    case "easy":      return "#00E676";
    case "medium":    return "#FFD700";
    case "hard":      return "#FF6B00";
    case "very_hard": return "#FF0057";
    case "legendary": return "#9B59B6";
    default:          return "#aaaaaa";
  }
}

function difficultyLabel(d: string): string {
  switch (d) {
    case "very_hard": return "Very Hard";
    case "legendary": return "Legendary";
    default:          return d.charAt(0).toUpperCase() + d.slice(1);
  }
}

export default function TitleUnlockModal() {
  const { pendingUnlock, dismissCurrent, equip } = useTitleUnlock();
  const colors   = useColors();
  const [equipping, setEquipping] = useState(false);
  const [equipped,  setEquipped]  = useState(false);

  const scaleAnim   = useRef(new Animated.Value(0.82)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const sparkle     = useRef(new Animated.Value(0)).current;
  const loopRef     = useRef<Animated.CompositeAnimation | null>(null);

  const visible = !!pendingUnlock;

  useEffect(() => {
    if (visible) {
      setEquipped(false);
      setEquipping(false);
      Animated.parallel([
        Animated.spring(scaleAnim,   { toValue: 1, useNativeDriver: true, tension: 90, friction: 9 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
      loopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(sparkle, { toValue: 1, duration: 1400, useNativeDriver: true }),
          Animated.timing(sparkle, { toValue: 0, duration: 1400, useNativeDriver: true }),
        ]),
      );
      loopRef.current.start();
    } else {
      loopRef.current?.stop();
      scaleAnim.setValue(0.82);
      opacityAnim.setValue(0);
      sparkle.setValue(0);
    }
  }, [visible, scaleAnim, opacityAnim, sparkle]);

  const handleEquip = useCallback(async () => {
    if (equipping || equipped) return;
    setEquipping(true);
    const result = await equip();
    setEquipping(false);
    if (result) {
      setEquipped(true);
      setTimeout(() => dismissCurrent(), 1400);
    }
  }, [equip, equipping, equipped, dismissCurrent]);

  if (!pendingUnlock) return null;

  const dColor = difficultyColor(pendingUnlock.difficulty);
  const glowOpacity = sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.06, 0.20] });

  return (
    <Modal transparent animationType="none" visible={visible} onRequestClose={dismissCurrent}>
      <Animated.View style={[st.overlay, { opacity: opacityAnim }]}>
        <Animated.View
          style={[
            st.card,
            { backgroundColor: colors.card, borderColor: dColor + "55" },
            { transform: [{ scale: scaleAnim }] },
          ]}
        >
          {/* Animated glow behind content */}
          <Animated.View style={[st.glow, { backgroundColor: dColor, opacity: glowOpacity }]} />

          {/* "New Title Unlocked" header */}
          <View style={st.headerRow}>
            <Text style={st.headerEmoji}>🏆</Text>
            <Text style={[st.headerLabel, { color: dColor }]}>New Title Unlocked!</Text>
          </View>

          {/* Large badge */}
          <View style={st.badgeWrap}>
            <TitleBadge
              code={pendingUnlock.code}
              difficulty={pendingUnlock.difficulty}
              size={88}
              locked={false}
            />
          </View>

          {/* Title name */}
          <Text style={[st.titleText, { color: colors.foreground }]}>
            {pendingUnlock.title}
          </Text>

          {/* Difficulty pill */}
          <View style={[st.diffPill, { backgroundColor: dColor + "1A", borderColor: dColor + "55" }]}>
            <Text style={[st.diffText, { color: dColor }]}>
              {difficultyLabel(pendingUnlock.difficulty)}
            </Text>
          </View>

          {/* Divider */}
          <View style={[st.divider, { backgroundColor: colors.border }]} />

          {/* Equip button */}
          {equipped ? (
            <View style={st.equipWrap}>
              <LinearGradient
                colors={["#00C853", "#00E676"]}
                style={st.equipGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Feather name="check" size={17} color="#000" />
                <Text style={[st.equipText, { color: "#000" }]}>Title Equipped!</Text>
              </LinearGradient>
            </View>
          ) : (
            <TouchableOpacity
              style={st.equipWrap}
              onPress={handleEquip}
              activeOpacity={0.82}
              disabled={equipping}
            >
              <LinearGradient
                colors={["#6C00FF", "#B44DFF"]}
                style={st.equipGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                {equipping ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Feather name="award" size={17} color="#fff" />
                    <Text style={st.equipText}>Equip New Title</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Maybe Later */}
          {!equipped && (
            <TouchableOpacity onPress={dismissCurrent} activeOpacity={0.7} style={st.laterBtn}>
              <Text style={[st.laterText, { color: colors.mutedForeground }]}>Maybe Later</Text>
            </TouchableOpacity>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 26,
    borderWidth: 1.5,
    paddingVertical: 30,
    paddingHorizontal: 26,
    alignItems: "center",
    gap: 12,
    overflow: "hidden",
  },
  glow: {
    position: "absolute",
    top: -60,
    left: -60,
    right: -60,
    height: 220,
    borderRadius: 110,
  },
  headerRow:   { flexDirection: "row", alignItems: "center", gap: 7 },
  headerEmoji: { fontSize: 18 },
  headerLabel: { fontSize: 12, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  badgeWrap:   { marginVertical: 6 },
  titleText:   { fontSize: 24, fontWeight: "900", textAlign: "center", letterSpacing: -0.4 },
  diffPill:    { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  diffText:    { fontSize: 11, fontWeight: "700" },
  divider:     { width: "100%", height: StyleSheet.hairlineWidth, marginVertical: 4 },
  equipWrap:   { width: "100%", borderRadius: 14, overflow: "hidden" },
  equipGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  equipText:   { fontSize: 15, fontWeight: "800", color: "#fff" },
  laterBtn:    { paddingVertical: 8, paddingHorizontal: 16 },
  laterText:   { fontSize: 14, fontWeight: "600" },
});
