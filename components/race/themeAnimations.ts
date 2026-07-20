// ── Track Theme Animation Configuration ───────────────────────────────────────
// Defines per-theme overlay effects for the race track screen.
// No assets are changed. Overlays render above the background image
// but below player avatars (zIndex 4, runners are zIndex 8).
//
// Visibility targets (v2 — "clearly visible on real phones"):
//   glowOpacity:        0.18 – 0.38
//   maxParticleOpacity: 0.80 – 0.95
//   particleCount:      9  – 12

export const ENABLE_TRACK_THEME_ANIMATIONS = true;

export type ParticleDirection = "up" | "down" | "pulse";

export interface ThemeAnimConfig {
  direction: ParticleDirection;
  primaryColor: string;
  secondaryColor: string;
  glowColor: string;
  glowOpacity: number;           // max glow opacity (0.10 – 0.38)
  glowPosition: "bottom" | "top" | "both";
  particleCount: number;         // 9 – 12 (keep reasonable for perf)
  baseDuration: number;          // ms for one particle cycle
  travelY: number;               // pixels to travel vertically
  maxParticleOpacity: number;    // 0 – 1
  particleSizeRange: [number, number]; // [min, max] px
  hasSymbol?: boolean;           // render text symbol (notes, leaves)
  symbol?: string;               // the symbol char, e.g. "♪"
  symbols?: string[];            // alternate symbols
}

// X positions as percentage strings (8 lanes across the track)
export const PARTICLE_X_PCT = ["4%", "14%", "25%", "38%", "51%", "63%", "75%", "88%"] as const;

// Stagger multipliers per lane index (so particles don't all pulse together)
export const DELAY_BY_LANE = [0, 600, 1200, 300, 900, 150, 750, 450] as const;

// Duration spread so particles don't synchronize
export const DURATION_MULT = [1.0, 1.25, 0.85, 1.1, 0.9, 1.2, 0.95, 0.8] as const;

// Y start positions as percentage strings per direction
export const START_Y_UP   = ["82%", "78%", "88%", "80%", "85%", "76%", "90%", "83%"] as const;
export const START_Y_DOWN = ["2%",  "5%",  "0%",  "8%",  "3%",  "6%",  "1%",  "4%"] as const;
export const START_Y_PULSE = ["25%", "60%", "40%", "15%", "70%", "50%", "30%", "80%"] as const;

export const THEME_ANIMATION_CONFIG: Record<string, ThemeAnimConfig> = {

  // ── Neon Finish ─────────────────────────────────────────────────────────────
  // Pulsing cyan/purple neon streaks + strong bottom glow
  bg: {
    direction: "up",
    primaryColor: "#00FFEE",
    secondaryColor: "#CC44FF",
    glowColor: "#00AACC",
    glowOpacity: 0.32,
    glowPosition: "bottom",
    particleCount: 10,
    baseDuration: 2400,
    travelY: 380,
    maxParticleOpacity: 0.92,
    particleSizeRange: [4, 9],
  },

  // ── Arcade Track ─────────────────────────────────────────────────────────────
  // Golden/red pixel sparks with strong orange glow
  bg1: {
    direction: "up",
    primaryColor: "#FFD700",
    secondaryColor: "#FF6E40",
    glowColor: "#FF9100",
    glowOpacity: 0.26,
    glowPosition: "bottom",
    particleCount: 10,
    baseDuration: 2100,
    travelY: 340,
    maxParticleOpacity: 0.92,
    particleSizeRange: [3, 8],
  },

  // ── Galaxy ───────────────────────────────────────────────────────────────────
  // White/blue star twinkles + deep indigo ambient glow on both edges
  galaxy: {
    direction: "pulse",
    primaryColor: "#FFFFFF",
    secondaryColor: "#8EC5FF",
    glowColor: "#1A237E",
    glowOpacity: 0.28,
    glowPosition: "both",
    particleCount: 12,
    baseDuration: 3200,
    travelY: 0,
    maxParticleOpacity: 0.95,
    particleSizeRange: [3, 7],
  },

  // ── Daylight Stadium ─────────────────────────────────────────────────────────
  // Golden confetti/sparkle falling from top + warm sun-glow
  daylightStadium: {
    direction: "down",
    primaryColor: "#FFD700",
    secondaryColor: "#FFF9C4",
    glowColor: "#FDD835",
    glowOpacity: 0.24,
    glowPosition: "top",
    particleCount: 10,
    baseDuration: 4500,
    travelY: 400,
    maxParticleOpacity: 0.85,
    particleSizeRange: [3, 7],
  },

  // ── Forest ───────────────────────────────────────────────────────────────────
  // Green leaf symbols drifting down + forest edge glow
  forest: {
    direction: "down",
    primaryColor: "#66BB6A",
    secondaryColor: "#AED581",
    glowColor: "#1B5E20",
    glowOpacity: 0.26,
    glowPosition: "both",
    particleCount: 10,
    baseDuration: 5000,
    travelY: 420,
    maxParticleOpacity: 0.88,
    particleSizeRange: [7, 13],
    hasSymbol: true,
    symbols: ["🍃", "🌿"],
  },

  // ── Farm ─────────────────────────────────────────────────────────────────────
  // Yellow pollen/seeds drifting with warm harvest glow
  farm: {
    direction: "down",
    primaryColor: "#FFF176",
    secondaryColor: "#C5E1A5",
    glowColor: "#F57F17",
    glowOpacity: 0.24,
    glowPosition: "both",
    particleCount: 9,
    baseDuration: 5500,
    travelY: 400,
    maxParticleOpacity: 0.88,
    particleSizeRange: [4, 9],
  },

  // ── City ─────────────────────────────────────────────────────────────────────
  // Amber streetlight flickers with urban orange bottom glow
  city: {
    direction: "pulse",
    primaryColor: "#FFB300",
    secondaryColor: "#FF6D00",
    glowColor: "#E65100",
    glowOpacity: 0.26,
    glowPosition: "bottom",
    particleCount: 10,
    baseDuration: 1900,
    travelY: 0,
    maxParticleOpacity: 0.88,
    particleSizeRange: [4, 9],
  },

  // ── Lava ─────────────────────────────────────────────────────────────────────
  // Rising orange/red embers + strong molten bottom glow
  lava: {
    direction: "up",
    primaryColor: "#FF5722",
    secondaryColor: "#FF9800",
    glowColor: "#BF360C",
    glowOpacity: 0.38,
    glowPosition: "bottom",
    particleCount: 12,
    baseDuration: 2000,
    travelY: 360,
    maxParticleOpacity: 0.95,
    particleSizeRange: [4, 10],
  },

  // ── Ice ──────────────────────────────────────────────────────────────────────
  // White snowflake symbols drifting down + icy blue ambient glow
  ice: {
    direction: "down",
    primaryColor: "#FFFFFF",
    secondaryColor: "#B3E5FC",
    glowColor: "#0277BD",
    glowOpacity: 0.28,
    glowPosition: "top",
    particleCount: 11,
    baseDuration: 5200,
    travelY: 440,
    maxParticleOpacity: 0.90,
    particleSizeRange: [4, 10],
    hasSymbol: true,
    symbol: "❄",
  },

  // ── Candy Land ───────────────────────────────────────────────────────────────
  // Pink/purple rising bubbles + hot-pink glow
  candy: {
    direction: "up",
    primaryColor: "#FF80AB",
    secondaryColor: "#CE93D8",
    glowColor: "#AD1457",
    glowOpacity: 0.26,
    glowPosition: "bottom",
    particleCount: 10,
    baseDuration: 3400,
    travelY: 380,
    maxParticleOpacity: 0.88,
    particleSizeRange: [7, 16],
  },

  // ── Underwater ───────────────────────────────────────────────────────────────
  // Light-blue bubble outlines rising + deep ocean ambient glow
  underwater: {
    direction: "up",
    primaryColor: "#4FC3F7",
    secondaryColor: "#B3E5FC",
    glowColor: "#01579B",
    glowOpacity: 0.32,
    glowPosition: "both",
    particleCount: 11,
    baseDuration: 3600,
    travelY: 400,
    maxParticleOpacity: 0.85,
    particleSizeRange: [6, 15],
  },

  // ── Music Fest ───────────────────────────────────────────────────────────────
  // Pink/cyan music notes rising + purple stage-light glow
  musicfest: {
    direction: "up",
    primaryColor: "#EA80FC",
    secondaryColor: "#40C4FF",
    glowColor: "#6A1B9A",
    glowOpacity: 0.30,
    glowPosition: "both",
    particleCount: 9,
    baseDuration: 2800,
    travelY: 370,
    maxParticleOpacity: 0.92,
    particleSizeRange: [10, 17],
    hasSymbol: true,
    symbols: ["♪", "♫"],
  },

  // ── Barbie ───────────────────────────────────────────────────────────────────
  // Hot-pink sparkle bubbles rising + deep pink neon glow
  barbie: {
    direction: "up",
    primaryColor: "#FF69B4",
    secondaryColor: "#FFB6C1",
    glowColor: "#FF1493",
    glowOpacity: 0.30,
    glowPosition: "bottom",
    particleCount: 10,
    baseDuration: 3200,
    travelY: 380,
    maxParticleOpacity: 0.90,
    particleSizeRange: [6, 14],
  },

  // ── Desert ───────────────────────────────────────────────────────────────────
  // Golden sand/dust particles rising + warm amber ground glow
  desert: {
    direction: "up",
    primaryColor: "#E8B84B",
    secondaryColor: "#F5DEB3",
    glowColor: "#D2691E",
    glowOpacity: 0.26,
    glowPosition: "bottom",
    particleCount: 9,
    baseDuration: 4000,
    travelY: 360,
    maxParticleOpacity: 0.85,
    particleSizeRange: [4, 9],
  },

  // ── Gold ─────────────────────────────────────────────────────────────────────
  // Gold glitter pulsing + metallic golden ambient glow
  gold: {
    direction: "pulse",
    primaryColor: "#FFD700",
    secondaryColor: "#FFF8DC",
    glowColor: "#B8860B",
    glowOpacity: 0.34,
    glowPosition: "both",
    particleCount: 11,
    baseDuration: 2300,
    travelY: 0,
    maxParticleOpacity: 0.95,
    particleSizeRange: [4, 10],
  },

  // ── Night Forest ─────────────────────────────────────────────────────────────
  // Bright green firefly pulses + dark forest ambient glow
  nightforest: {
    direction: "pulse",
    primaryColor: "#39FF14",
    secondaryColor: "#7FFF00",
    glowColor: "#006400",
    glowOpacity: 0.28,
    glowPosition: "both",
    particleCount: 11,
    baseDuration: 3400,
    travelY: 0,
    maxParticleOpacity: 0.92,
    particleSizeRange: [5, 11],
  },

  // ── Sky Kingdom ──────────────────────────────────────────────────────────────
  // White/gold celestial star twinkles + sky blue ambient glow
  skykingdom: {
    direction: "pulse",
    primaryColor: "#FFFFFF",
    secondaryColor: "#FFD700",
    glowColor: "#87CEEB",
    glowOpacity: 0.24,
    glowPosition: "both",
    particleCount: 10,
    baseDuration: 3000,
    travelY: 0,
    maxParticleOpacity: 0.95,
    particleSizeRange: [3, 8],
  },

  // ── Rain ─────────────────────────────────────────────────────────────────────
  // Dense blue raindrop streaks falling fast + rain-cloud top glow
  rain: {
    direction: "down",
    primaryColor: "#4FC3F7",
    secondaryColor: "#B3E5FC",
    glowColor: "#01579B",
    glowOpacity: 0.30,
    glowPosition: "top",
    particleCount: 12,
    baseDuration: 1500,
    travelY: 460,
    maxParticleOpacity: 0.88,
    particleSizeRange: [2, 5],
  },

  // ── Storm ────────────────────────────────────────────────────────────────────
  // Fast dark-blue/white lightning streaks + electric edge glow
  storm: {
    direction: "down",
    primaryColor: "#E0E0E0",
    secondaryColor: "#90CAF9",
    glowColor: "#1A237E",
    glowOpacity: 0.34,
    glowPosition: "both",
    particleCount: 10,
    baseDuration: 1400,
    travelY: 440,
    maxParticleOpacity: 0.90,
    particleSizeRange: [2, 6],
  },

  // ── Mountain ─────────────────────────────────────────────────────────────────
  // White snowflakes drifting down slowly + cool steel-blue top glow
  mountain: {
    direction: "down",
    primaryColor: "#FFFFFF",
    secondaryColor: "#CFD8DC",
    glowColor: "#546E7A",
    glowOpacity: 0.24,
    glowPosition: "top",
    particleCount: 10,
    baseDuration: 5500,
    travelY: 420,
    maxParticleOpacity: 0.88,
    particleSizeRange: [4, 10],
    hasSymbol: true,
    symbol: "❄",
  },

  // ── Waterfall ────────────────────────────────────────────────────────────────
  // Cyan mist/droplets rising + deep teal ambient glow
  waterfall: {
    direction: "up",
    primaryColor: "#00BCD4",
    secondaryColor: "#80DEEA",
    glowColor: "#006064",
    glowOpacity: 0.30,
    glowPosition: "both",
    particleCount: 11,
    baseDuration: 2900,
    travelY: 400,
    maxParticleOpacity: 0.88,
    particleSizeRange: [5, 12],
  },

  // ── Web City ─────────────────────────────────────────────────────────────────
  // Red/blue cyberpunk neon streaks rising + dark neon bottom glow
  webcity: {
    direction: "up",
    primaryColor: "#FF1744",
    secondaryColor: "#00B0FF",
    glowColor: "#0D0D0D",
    glowOpacity: 0.32,
    glowPosition: "bottom",
    particleCount: 11,
    baseDuration: 1800,
    travelY: 360,
    maxParticleOpacity: 0.95,
    particleSizeRange: [3, 8],
  },

  // ── Bridge ───────────────────────────────────────────────────────────────────
  // Red/white light pulses + crimson edge glow
  bridge: {
    direction: "pulse",
    primaryColor: "#FF4444",
    secondaryColor: "#FFFFFF",
    glowColor: "#CC0000",
    glowOpacity: 0.28,
    glowPosition: "both",
    particleCount: 9,
    baseDuration: 2100,
    travelY: 0,
    maxParticleOpacity: 0.90,
    particleSizeRange: [4, 9],
  },

  // ── New York ─────────────────────────────────────────────────────────────────
  // Amber/gold city-light flickers + orange urban glow
  newyork: {
    direction: "pulse",
    primaryColor: "#FFB300",
    secondaryColor: "#FFF9C4",
    glowColor: "#E65100",
    glowOpacity: 0.26,
    glowPosition: "bottom",
    particleCount: 10,
    baseDuration: 2000,
    travelY: 0,
    maxParticleOpacity: 0.88,
    particleSizeRange: [4, 9],
  },

  // ── Pirate Island ────────────────────────────────────────────────────────────
  // Gold coin sparks rising + warm torchlit brown glow
  pirateisland: {
    direction: "up",
    primaryColor: "#FFD700",
    secondaryColor: "#DEB887",
    glowColor: "#8B4513",
    glowOpacity: 0.28,
    glowPosition: "bottom",
    particleCount: 9,
    baseDuration: 3600,
    travelY: 370,
    maxParticleOpacity: 0.90,
    particleSizeRange: [5, 11],
  },

  // ── Paradise ─────────────────────────────────────────────────────────────────
  // Tropical teal sparkles rising + ocean ambient glow
  paradise: {
    direction: "up",
    primaryColor: "#26C6DA",
    secondaryColor: "#80DEEA",
    glowColor: "#00838F",
    glowOpacity: 0.28,
    glowPosition: "both",
    particleCount: 10,
    baseDuration: 3400,
    travelY: 380,
    maxParticleOpacity: 0.88,
    particleSizeRange: [6, 13],
  },

  // ── Music Fest 2 ─────────────────────────────────────────────────────────────
  // Blue/pink music notes rising + stronger stage-light glow
  musicfest2: {
    direction: "up",
    primaryColor: "#2196F3",
    secondaryColor: "#E91E63",
    glowColor: "#1A237E",
    glowOpacity: 0.30,
    glowPosition: "both",
    particleCount: 9,
    baseDuration: 2700,
    travelY: 370,
    maxParticleOpacity: 0.92,
    particleSizeRange: [10, 17],
    hasSymbol: true,
    symbols: ["♪", "♫"],
  },
};

// ── Fallback preset resolver (for unknown backend themes) ─────────────────────
// Inspects the theme code/name and picks the closest preset category.
export function getFallbackAnimConfig(themeCode: string): ThemeAnimConfig {
  const key = themeCode.toLowerCase();

  if (/music|fest/.test(key)) return THEME_ANIMATION_CONFIG.musicfest!;
  if (/neon|cyber|web/.test(key)) return THEME_ANIMATION_CONFIG.webcity!;
  if (/ice|snow|frost/.test(key)) return THEME_ANIMATION_CONFIG.ice!;
  if (/lava|fire|volcano/.test(key)) return THEME_ANIMATION_CONFIG.lava!;
  if (/desert|sand|dune/.test(key)) return THEME_ANIMATION_CONFIG.desert!;
  if (/forest|jungle|nature/.test(key)) return THEME_ANIMATION_CONFIG.forest!;
  if (/farm|rural|barn/.test(key)) return THEME_ANIMATION_CONFIG.farm!;
  if (/paradise|tropical|island/.test(key)) return THEME_ANIMATION_CONFIG.paradise!;
  if (/rain|drizzle/.test(key)) return THEME_ANIMATION_CONFIG.rain!;
  if (/storm|thunder|lightning/.test(key)) return THEME_ANIMATION_CONFIG.storm!;
  if (/waterfall|cascade|mist/.test(key)) return THEME_ANIMATION_CONFIG.waterfall!;
  if (/underwater|ocean|sea|aqua/.test(key)) return THEME_ANIMATION_CONFIG.underwater!;
  if (/city|urban|metro/.test(key)) return THEME_ANIMATION_CONFIG.city!;
  if (/york|bridge|downtown/.test(key)) return THEME_ANIMATION_CONFIG.newyork!;
  if (/galaxy|space|cosmos|star/.test(key)) return THEME_ANIMATION_CONFIG.galaxy!;
  if (/gold|trophy|luxury/.test(key)) return THEME_ANIMATION_CONFIG.gold!;
  if (/sky|cloud|heaven|angel/.test(key)) return THEME_ANIMATION_CONFIG.skykingdom!;
  if (/night|dark|moon/.test(key)) return THEME_ANIMATION_CONFIG.nightforest!;
  if (/mountain|peak|cliff/.test(key)) return THEME_ANIMATION_CONFIG.mountain!;
  if (/pirate|treasure/.test(key)) return THEME_ANIMATION_CONFIG.pirateisland!;
  if (/candy|sweet|sugar/.test(key)) return THEME_ANIMATION_CONFIG.candy!;
  if (/barbie|pink|glam/.test(key)) return THEME_ANIMATION_CONFIG.barbie!;
  if (/arcade|retro|pixel/.test(key)) return THEME_ANIMATION_CONFIG.bg1!;

  // Generic default: subtle upward particles + mild lane glow
  return {
    direction: "up",
    primaryColor: "#FFFFFF",
    secondaryColor: "#A0C4FF",
    glowColor: "#1565C0",
    glowOpacity: 0.20,
    glowPosition: "bottom",
    particleCount: 9,
    baseDuration: 3500,
    travelY: 350,
    maxParticleOpacity: 0.80,
    particleSizeRange: [3, 7],
  };
}
