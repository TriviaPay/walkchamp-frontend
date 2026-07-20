import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";

// ── Types ─────────────────────────────────────────────────────────────────────
type MCIcon = React.ComponentProps<typeof MaterialCommunityIcons>["name"];

interface IconDef  { kind: "icon"; icon: MCIcon; color: string }
interface TextDef  { kind: "text"; label: string; color: string }
type BadgeDef = IconDef | TextDef;

// ── Difficulty fallback icons (used when code is unknown) ─────────────────────
const DIFFICULTY_DEFAULTS: Record<string, BadgeDef> = {
  easy:      { kind: "icon", icon: "shoe-print",    color: "#00E676" },
  medium:    { kind: "icon", icon: "medal-outline",  color: "#FFD700" },
  hard:      { kind: "icon", icon: "shield-check",   color: "#FF6B00" },
  very_hard: { kind: "icon", icon: "crown",          color: "#FF0057" },
  legendary: { kind: "icon", icon: "star-shooting",  color: "#9B59B6" },
};
const ULTIMATE_DEFAULT: BadgeDef = { kind: "icon", icon: "medal", color: "#888" };

// ── Full badge map ─────────────────────────────────────────────────────────────
const BADGE_MAP: Record<string, BadgeDef> = {
  // ─── EASY ──────────────────────────────────────────────────────────────────
  first_stepper:          { kind: "icon", icon: "shoe-print",             color: "#00E676" },
  daily_starter:          { kind: "icon", icon: "weather-sunset-up",       color: "#69F0AE" },
  goal_chaser:            { kind: "icon", icon: "target",                  color: "#00BCD4" },
  halfway_hero:           { kind: "icon", icon: "lightning-bolt",          color: "#4FC3F7" },
  almost_there:           { kind: "icon", icon: "fire",                    color: "#FF7043" },
  goal_finisher:          { kind: "icon", icon: "check-decagram",          color: "#00E676" },
  one_k_walker:           { kind: "text", label: "1K",                    color: "#00BCD4" },
  five_k_walker:          { kind: "text", label: "5K",                    color: "#00E676" },
  morning_walker:         { kind: "icon", icon: "weather-sunny",           color: "#FFEE58" },
  night_walker:           { kind: "icon", icon: "moon-waning-crescent",    color: "#7986CB" },
  first_race_finisher:    { kind: "icon", icon: "flag-checkered",          color: "#4DB6AC" },
  friendly_walker:        { kind: "icon", icon: "account-plus",            color: "#81C784" },
  cheer_giver:            { kind: "icon", icon: "hand-wave",               color: "#AED581" },
  rookie_racer:           { kind: "icon", icon: "flag-outline",            color: "#80DEEA" },
  bronze_walker:          { kind: "icon", icon: "medal",                   color: "#CD7F32" },

  // ─── MEDIUM ────────────────────────────────────────────────────────────────
  daily_top_10:           { kind: "icon", icon: "counter",                 color: "#FFD740" },
  daily_top_3:            { kind: "icon", icon: "medal-outline",           color: "#FFD700" },
  daily_champion:         { kind: "icon", icon: "trophy",                  color: "#FFB300" },
  weekly_top_10:          { kind: "icon", icon: "calendar-clock",          color: "#FFA726" },
  weekly_warrior:         { kind: "icon", icon: "calendar-star",           color: "#FFD700" },
  ten_k_club:             { kind: "text", label: "10K",                   color: "#FFD700" },
  consistent_walker:      { kind: "icon", icon: "calendar-check",          color: "#FFCA28" },
  streak_builder:         { kind: "icon", icon: "fire-circle",             color: "#FF8F00" },
  race_contender:         { kind: "icon", icon: "gauge",                   color: "#FFAB40" },
  race_winner:            { kind: "icon", icon: "flag-variant",            color: "#FFD700" },
  fast_finisher:          { kind: "icon", icon: "timer",                   color: "#FFE082" },
  friend_challenger:      { kind: "icon", icon: "account-group",           color: "#FFF176" },
  regional_top_10:        { kind: "icon", icon: "map-marker",              color: "#FFCC02" },
  global_top_100:         { kind: "icon", icon: "earth",                   color: "#FFB300" },
  rising_walker:          { kind: "icon", icon: "chart-line-variant",      color: "#FFE57F" },

  // ─── HARD ──────────────────────────────────────────────────────────────────
  weekly_champion:        { kind: "icon", icon: "trophy-outline",          color: "#FF6B00" },
  monthly_top_10:         { kind: "icon", icon: "calendar-range",          color: "#FF7043" },
  regional_champion:      { kind: "icon", icon: "map-marker-check",        color: "#FF5722" },
  global_top_50:          { kind: "icon", icon: "earth-box",               color: "#FF6B00" },
  global_top_25:          { kind: "icon", icon: "earth-box-minus",         color: "#FF4500" },
  twenty_k_beast:         { kind: "text", label: "20K",                   color: "#FF6B00" },
  endurance_walker:       { kind: "icon", icon: "heart-pulse",             color: "#FF7043" },
  streak_master:          { kind: "icon", icon: "shield-check",            color: "#FF6B00" },
  race_dominator:         { kind: "icon", icon: "crown",                   color: "#FF5722" },
  podium_king:            { kind: "icon", icon: "podium-gold",             color: "#FF6B00" },
  country_warrior:        { kind: "icon", icon: "flag",                    color: "#FF7043" },
  elite_walker:           { kind: "icon", icon: "shield-account",          color: "#FF6B00" },
  speed_strider:          { kind: "icon", icon: "lightning-bolt-outline",  color: "#FF5722" },
  comeback_walker:        { kind: "icon", icon: "rotate-left",             color: "#FF6B00" },
  no_excuses:             { kind: "icon", icon: "run",                     color: "#FF7043" },

  // ─── VERY HARD ─────────────────────────────────────────────────────────────
  monthly_champion:       { kind: "icon", icon: "crown-outline",           color: "#FF0057" },
  global_top_10:          { kind: "icon", icon: "earth-plus",              color: "#FF1744" },
  global_champion:        { kind: "icon", icon: "trophy-award",            color: "#FF0057" },
  regional_legend:        { kind: "icon", icon: "map-marker-star",         color: "#FF1744" },
  race_legend:            { kind: "icon", icon: "chess-rook",                color: "#FF0057" },
  hundred_k_week_club:    { kind: "text", label: "100K",                  color: "#FF0057" },
  five_hundred_k_month_club: { kind: "text", label: "500K",              color: "#FF1744" },
  iron_streak:            { kind: "icon", icon: "shield-lock",             color: "#FF0057" },
  marathon_walker:        { kind: "text", label: "42K",                   color: "#FF1744" },
  unstoppable:            { kind: "icon", icon: "infinity",                color: "#FF0057" },

  // ─── LEGENDARY ─────────────────────────────────────────────────────────────
  walkchamp_legend:       { kind: "icon", icon: "diamond",                 color: "#FFD700" },
  global_crown_holder:    { kind: "icon", icon: "earth-arrow-right",       color: "#CE93D8" },
  world_class_walker:     { kind: "icon", icon: "star-four-points",        color: "#AB47BC" },
  hall_of_fame_walker:    { kind: "icon", icon: "star-circle",             color: "#9B59B6" },
  one_million_steps_club: { kind: "text", label: "1M",                    color: "#CE93D8" },
  five_million_steps_club:{ kind: "text", label: "5M",                    color: "#9B59B6" },
  ten_million_steps_legend:{ kind: "text", label: "10M",                  color: "#7B1FA2" },
  hundred_race_champion:  { kind: "text", label: "×100",                  color: "#AB47BC" },
  country_hero:           { kind: "icon", icon: "shield-star",             color: "#9B59B6" },
  eternal_streak:         { kind: "icon", icon: "weather-lightning-rainy", color: "#7B1FA2" },
  grandmaster_walker:     { kind: "icon", icon: "star-shooting",           color: "#CE93D8" },
  supreme_strider:        { kind: "icon", icon: "rocket-launch",           color: "#9B59B6" },
  walking_titan:          { kind: "icon", icon: "image-filter-hdr",        color: "#7B1FA2" },
  immortal_walker:        { kind: "icon", icon: "fleur-de-lis",            color: "#AB47BC" },
  the_walkchamp:          { kind: "icon", icon: "crown-circle",            color: "#FFD700" },
};

// ── Component ──────────────────────────────────────────────────────────────────
interface Props {
  code:       string;
  difficulty?: string;
  size?:      number;
  locked?:    boolean;
}

export function TitleBadge({ code, difficulty = "easy", size = 48, locked = false }: Props) {
  const raw  = BADGE_MAP[code] ?? DIFFICULTY_DEFAULTS[difficulty] ?? ULTIMATE_DEFAULT;
  const def: BadgeDef = locked
    ? { ...raw, color: "#666" }
    : raw;

  const iconSz  = Math.round(size * 0.48);
  const radius  = Math.round(size * 0.24);
  const bColor  = def.color;

  return (
    <View style={[
      st.wrap,
      {
        width:           size,
        height:          size,
        borderRadius:    radius,
        backgroundColor: bColor + (locked ? "0E" : "18"),
        borderColor:     bColor + (locked ? "30" : "60"),
        shadowColor:     locked ? "transparent" : bColor,
      },
    ]}>
      {def.kind === "icon" ? (
        <MaterialCommunityIcons name={def.icon} size={iconSz} color={bColor} />
      ) : (
        <Text style={[st.labelText, { color: bColor, fontSize: iconSz * 0.52 }]}>
          {def.label}
        </Text>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: {
    borderWidth:    1.5,
    alignItems:     "center",
    justifyContent: "center",
    shadowOffset:   { width: 0, height: 0 },
    shadowOpacity:  0.45,
    shadowRadius:   8,
    elevation:      4,
  },
  labelText: {
    fontWeight:  "900",
    letterSpacing: -0.5,
    textAlign:   "center",
  },
});
