import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { COUNTRIES, type Country } from "@/constants/countries";

const POPULAR_MATCHUPS: [string, string][] = [
  ["IN", "US"],
  ["IN", "CN"],
  ["US", "CN"],
  ["GB", "DE"],
  ["BR", "AR"],
  ["JP", "KR"],
  ["AU", "NZ"],
  ["NG", "ZA"],
];

interface Props {
  teamA: Country;
  teamB: Country;
  onChangeA: (c: Country) => void;
  onChangeB: (c: Country) => void;
  teamALocked?: boolean;
}

export default function CountryBattleSelector({ teamA, teamB, onChangeA, onChangeB, teamALocked = false }: Props) {
  const [picking, setPicking] = useState<"A" | "B" | null>(null);

  const handlePickMatchup = (codeA: string, codeB: string) => {
    if (!teamALocked) {
      const a = COUNTRIES.find((c) => c.code === codeA);
      if (a) onChangeA(a);
    }
    const b = COUNTRIES.find((c) => c.code === codeB);
    if (b) onChangeB(b);
    setPicking(null);
  };

  const handleSelectCountry = (c: Country) => {
    if (picking === "A") onChangeA(c);
    else if (picking === "B") onChangeB(c);
    setPicking(null);
  };

  return (
    <View style={s.root}>
      {/* Battle Card */}
      <View style={s.card}>
        <View style={s.glowLine} />

        <View style={s.header}>
          <View style={s.headerBadge}>
            <Text style={s.headerBadgeText}>🌍  COUNTRY BATTLE</Text>
          </View>
        </View>

        {/* Teams Row */}
        <View style={s.teamsRow}>
          {/* Team A */}
          <TouchableOpacity
            style={[s.teamPanel, !teamALocked && picking === "A" && s.teamPanelActive, teamALocked && s.teamPanelLocked]}
            onPress={teamALocked ? undefined : () => setPicking(picking === "A" ? null : "A")}
            activeOpacity={teamALocked ? 1 : 0.78}
          >
            <Text style={s.teamLabel}>TEAM A</Text>
            <Text style={s.teamFlag}>{teamA.flag}</Text>
            <Text style={s.teamName} numberOfLines={2}>{teamA.name}</Text>
            {teamALocked ? (
              <View style={s.lockedBadge}>
                <Feather name="shield" size={10} color="#00E676" />
                <Text style={s.lockedBadgeText}>Your Country</Text>
              </View>
            ) : (
              <View style={[s.changeBtn, picking === "A" && s.changeBtnActive]}>
                <Feather
                  name={picking === "A" ? "chevron-up" : "edit-2"}
                  size={11}
                  color={picking === "A" ? "#00E676" : "#94A3B8"}
                />
                <Text style={[s.changeBtnText, picking === "A" && s.changeBtnTextActive]}>
                  {picking === "A" ? "Close" : "Change"}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          {/* VS Badge */}
          <View style={s.vsCol}>
            <View style={s.vsGlowOuter}>
              <Text style={s.vsText}>VS</Text>
            </View>
            {!teamALocked && (
              <TouchableOpacity
                style={s.swapBtn}
                onPress={() => { const tmp = teamA; onChangeA(teamB); onChangeB(tmp); }}
                hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
              >
                <Feather name="repeat" size={12} color="#8B9AC0" />
                <Text style={s.swapText}>Swap</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Team B */}
          <TouchableOpacity
            style={[s.teamPanel, picking === "B" && s.teamPanelActive]}
            onPress={() => setPicking(picking === "B" ? null : "B")}
            activeOpacity={0.78}
          >
            <Text style={s.teamLabel}>TEAM B</Text>
            <Text style={s.teamFlag}>{teamB.flag}</Text>
            <Text style={s.teamName} numberOfLines={2}>{teamB.name}</Text>
            <View style={[s.changeBtn, picking === "B" && s.changeBtnActive]}>
              <Feather
                name={picking === "B" ? "chevron-up" : "edit-2"}
                size={11}
                color={picking === "B" ? "#00E676" : "#94A3B8"}
              />
              <Text style={[s.changeBtnText, picking === "B" && s.changeBtnTextActive]}>
                {picking === "B" ? "Close" : "Change"}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        <Text style={s.hint}>
          Only players from {teamA.flag} or {teamB.flag} may join
        </Text>
      </View>

      {/* Inline country picker — only Team B when A is locked */}
      {picking !== null && (
        <View style={s.pickerBox}>
          <Text style={s.pickerTitle}>Select Team {picking}</Text>
          <View style={s.countryGrid}>
            {COUNTRIES.map((item) => {
              const selected =
                picking === "A" ? item.code === teamA.code : item.code === teamB.code;
              const otherCode = picking === "A" ? teamB.code : teamA.code;
              const isOther = item.code === otherCode;
              return (
                <TouchableOpacity
                  key={item.code}
                  style={[
                    s.countryChip,
                    selected && s.countryChipSelected,
                    isOther && s.countryChipOther,
                  ]}
                  onPress={() => !isOther && handleSelectCountry(item)}
                  activeOpacity={isOther ? 1 : 0.75}
                  disabled={isOther}
                >
                  <Text style={s.countryChipFlag}>{item.flag}</Text>
                  <Text
                    style={[
                      s.countryChipName,
                      selected && s.countryChipNameSel,
                      isOther && s.countryChipNameOther,
                    ]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  {selected && <Feather name="check" size={13} color="#00E676" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      )}

      {/* Popular Matchups */}
      {picking === null && (
        <>
          <Text style={s.popularLabel}>🔥  Popular Matchups</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.matchupsRow}
          >
            {POPULAR_MATCHUPS.map(([cA, cB]) => {
              const a = COUNTRIES.find((c) => c.code === cA);
              const b = COUNTRIES.find((c) => c.code === cB);
              if (!a || !b) return null;
              const active = teamALocked
                ? teamB.code === cB
                : teamA.code === cA && teamB.code === cB;
              const displayCodeA = teamALocked ? teamA.code : cA;
              const displayA = teamALocked ? teamA : a;
              return (
                <TouchableOpacity
                  key={`${cA}-${cB}`}
                  style={[s.matchupChip, active && s.matchupChipActive]}
                  onPress={() => handlePickMatchup(displayCodeA, cB)}
                  activeOpacity={0.75}
                >
                  <Text style={[s.matchupText, active && s.matchupTextActive]}>
                    {displayA.flag} vs {b.flag}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </>
      )}
    </View>
  );
}

const CARD_BG = "#0D1122";
const GREEN = "#00E676";
const GOLD = "#FFD700";

const s = StyleSheet.create({
  root: { marginBottom: 8 },

  card: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#00E67630",
    overflow: "hidden",
    marginBottom: 12,
    shadowColor: GREEN,
    shadowOpacity: 0.15,
    shadowRadius: 14,
    elevation: 5,
  },
  glowLine: {
    height: 2,
    backgroundColor: GREEN,
    opacity: 0.65,
  },
  header: {
    alignItems: "center",
    paddingTop: 14,
    paddingBottom: 6,
  },
  headerBadge: {
    backgroundColor: "#00E67614",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#00E67640",
    paddingHorizontal: 14,
    paddingVertical: 5,
  },
  headerBadgeText: {
    color: GREEN,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  teamsRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 8,
  },
  teamPanel: {
    flex: 1,
    alignItems: "center",
    gap: 5,
    backgroundColor: "#111827",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  teamPanelActive: {
    borderColor: GREEN + "60",
    backgroundColor: "#0D1F14",
  },
  teamPanelLocked: {
    borderColor: "#00E67630",
    backgroundColor: "#0D1F14",
  },
  teamLabel: {
    color: "#475569",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  teamFlag: {
    fontSize: 34,
    lineHeight: 40,
  },
  teamName: {
    color: "#E2E8F0",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 17,
  },
  changeBtn: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#1E293B",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#334155",
  },
  changeBtnActive: {
    borderColor: GREEN + "50",
    backgroundColor: "#0D2010",
  },
  changeBtnText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "600",
  },
  changeBtnTextActive: {
    color: GREEN,
  },
  lockedBadge: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#00E67614",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#00E67630",
  },
  lockedBadgeText: {
    color: GREEN,
    fontSize: 10,
    fontWeight: "700",
  },
  vsCol: {
    alignItems: "center",
    gap: 8,
    width: 50,
  },
  vsGlowOuter: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFD70015",
    borderWidth: 1.5,
    borderColor: "#FFD70040",
    alignItems: "center",
    justifyContent: "center",
  },
  vsText: {
    color: GOLD,
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 1,
  },
  swapBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  swapText: {
    color: "#8B9AC0",
    fontSize: 10,
    fontWeight: "600",
  },
  hint: {
    color: "#475569",
    fontSize: 11,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    lineHeight: 16,
  },

  pickerBox: {
    backgroundColor: CARD_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1E293B",
    padding: 12,
    marginBottom: 12,
  },
  pickerTitle: {
    color: GREEN,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  countryGrid: {
    flexDirection: "column",
    gap: 6,
  },
  countryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#111827",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingVertical: 9,
    paddingHorizontal: 12,
  },
  countryChipSelected: {
    borderColor: GREEN + "70",
    backgroundColor: "#0D2010",
  },
  countryChipOther: {
    opacity: 0.3,
  },
  countryChipFlag: {
    fontSize: 20,
    width: 26,
    textAlign: "center",
  },
  countryChipName: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
  },
  countryChipNameSel: {
    color: GREEN,
  },
  countryChipNameOther: {
    color: "#475569",
  },

  popularLabel: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  matchupsRow: {
    flexDirection: "row",
    gap: 8,
    paddingBottom: 4,
  },
  matchupChip: {
    backgroundColor: "#0D1122",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#1E293B",
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  matchupChipActive: {
    borderColor: GREEN + "70",
    backgroundColor: "#0D2010",
  },
  matchupText: {
    color: "#CBD5E1",
    fontSize: 14,
    fontWeight: "600",
  },
  matchupTextActive: {
    color: GREEN,
  },
});
