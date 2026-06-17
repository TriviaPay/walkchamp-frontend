// ── Per-track avatar position calibration ─────────────────────────────────────
//
// startYPercent  = visual START line (0=top, 1=bottom). Typically 0.84–0.88.
// finishYPercent = where the avatar CENTER sits when progress=1.
//
// FINISH RULE: the avatar at 100% must appear "directly below the Race Track /
// Live Board tab strip with a 4 px gap." The hero container starts at y=0 right
// below those tabs. An avatar of radius ~22 px centered at 7% of heroHeight
// puts its top edge ≈ (0.07×H − 22) px below the hero top — approximately
// 4-10 px on phones 350–600 px tall. All tracks share the same finishYPercent
// so the finish position is layout-driven, not image-driven.
//
// TRAPEZOID BOUNDARIES define the visible road edges at start (bottom) and
// finish (top) for perspective-accurate lane X positions.
//
// HOW TO CALIBRATE A TRACK (for startY and lane boundaries)
// ─────────────────────────────────────────────────────────
// 1. Tap the race title 5× to toggle the debug overlay.
// 2. Adjust startYPercent until the green START line sits on the visible
//    start marking in the track image.
// 3. Adjust bottomLeft/Right and topLeft/Right until lane dots align with
//    the visual road edges.
// 4. finishYPercent should remain 0.07 for all tracks unless a track image
//    unusually needs the avatar higher or lower.
//
// FORMULA (used in sampleTrack):
//   progress = clamp(currentRaceSteps / targetSteps, 0, 1)
//   avatarY  = startY + (finishY - startY) × progress
//
// At progress=0: avatar is at startY  (start line, bottom of road)
// At progress=1: avatar is at finishY (finish zone, top of road) — EXACT

export interface TrackCalibration {
  /** Y fraction for the START line (0=top of container, 1=bottom). Typically 0.84–0.88. */
  startYPercent: number;
  /**
   * Y fraction for the avatar CENTER when progress=1 (finish).
   * Keep at 0.07 for all tracks so the finish zone is directly below the
   * "Race Track / Live Board" tabs with a ~4 px gap on typical devices.
   */
  finishYPercent: number;
  /** Left road edge at the START (bottom) as fraction of container width. */
  bottomLeftPercent: number;
  /** Right road edge at the START (bottom) as fraction of container width. */
  bottomRightPercent: number;
  /** Left road edge at the FINISH (top) as fraction of container width. */
  topLeftPercent: number;
  /** Right road edge at the FINISH (top) as fraction of container width. */
  topRightPercent: number;
}

// Finish position is layout-driven: avatar center ≈ 6% from the hero top.
// This is chosen to match the RunnerMarker FINISH_GAP lock formula
// (size/2 + 5 px) at typical phone hero heights (350-600 px), so progress
// approaching 100% smoothly arrives at the lock position with no visible jump.
const FINISH_Y = 0.06;

// Default calibration — used only as a last-resort fallback.
// Every theme should have its own explicit entry below.
const DEFAULT_CAL: TrackCalibration = {
  startYPercent:      0.87,
  finishYPercent:     FINISH_Y,
  bottomLeftPercent:  0.105,
  bottomRightPercent: 0.895,
  topLeftPercent:     0.315,
  topRightPercent:    0.685,
};

export const TRACK_CALIBRATIONS: Record<string, TrackCalibration> = {

  // ── Neon Finish (bg) ────────────────────────────────────────────────────────
  bg: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Arcade Track (bg1) ──────────────────────────────────────────────────────
  bg1: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Galaxy ──────────────────────────────────────────────────────────────────
  galaxy: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Daylight Stadium ────────────────────────────────────────────────────────
  daylightStadium: {
    startYPercent:      0.85,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.30,
    topRightPercent:    0.70,
  },

  // ── Forest ──────────────────────────────────────────────────────────────────
  forest: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.32,
    topRightPercent:    0.68,
  },

  // ── City ────────────────────────────────────────────────────────────────────
  city: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Lava ────────────────────────────────────────────────────────────────────
  lava: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Ice ─────────────────────────────────────────────────────────────────────
  ice: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Candy Land (candy) ──────────────────────────────────────────────────────
  candy: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Farm ────────────────────────────────────────────────────────────────────
  farm: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Underwater ──────────────────────────────────────────────────────────────
  underwater: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Music Fest ──────────────────────────────────────────────────────────────
  musicfest: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.32,
    topRightPercent:    0.68,
  },

  // ── Barbie ──────────────────────────────────────────────────────────────────
  barbie: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.30,
    topRightPercent:    0.70,
  },

  // ── Desert ──────────────────────────────────────────────────────────────────
  desert: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Gold ────────────────────────────────────────────────────────────────────
  gold: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Night Forest ────────────────────────────────────────────────────────────
  nightforest: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.32,
    topRightPercent:    0.68,
  },

  // ── Sky Kingdom ─────────────────────────────────────────────────────────────
  skykingdom: {
    startYPercent:      0.85,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.30,
    topRightPercent:    0.70,
  },

  // ── Rain ────────────────────────────────────────────────────────────────────
  rain: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Storm ───────────────────────────────────────────────────────────────────
  storm: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Mountain ────────────────────────────────────────────────────────────────
  // finishYPercent overridden to 0.22: the Mountain track image has a winding
  // road whose FINISH gate sits visually at ~22% from the top of the image,
  // not at the near-top position used by straight-track themes (FINISH_Y=0.06).
  mountain: {
    startYPercent:      0.86,
    finishYPercent:     0.22,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Waterfall ───────────────────────────────────────────────────────────────
  waterfall: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Web City ────────────────────────────────────────────────────────────────
  webcity: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Bridge ──────────────────────────────────────────────────────────────────
  bridge: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.32,
    topRightPercent:    0.68,
  },

  // ── New York ────────────────────────────────────────────────────────────────
  newyork: {
    startYPercent:      0.87,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.105,
    bottomRightPercent: 0.895,
    topLeftPercent:     0.315,
    topRightPercent:    0.685,
  },

  // ── Pirate Island ───────────────────────────────────────────────────────────
  pirateisland: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.31,
    topRightPercent:    0.69,
  },

  // ── Paradise ────────────────────────────────────────────────────────────────
  paradise: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.30,
    topRightPercent:    0.70,
  },

  // ── Music Fest 2 ────────────────────────────────────────────────────────────
  musicfest2: {
    startYPercent:      0.86,
    finishYPercent:     FINISH_Y,
    bottomLeftPercent:  0.10,
    bottomRightPercent: 0.90,
    topLeftPercent:     0.32,
    topRightPercent:    0.68,
  },
};

/**
 * Return calibration for a track theme. Warns in dev if the theme has no
 * explicit entry — meaning someone added a track without calibrating it.
 */
export function getTrackCalibration(themeId: string): TrackCalibration {
  const cal = TRACK_CALIBRATIONS[themeId];
  if (!cal) {
    if (__DEV__) {
      if (__DEV__) console.warn(
        `[RaceTrack] Missing calibration for theme: "${themeId}". ` +
        "Add an entry to TRACK_CALIBRATIONS in trackCalibrations.ts. " +
        "Using default fallback — finish positioning will likely be inaccurate.",
      );
    }
    return DEFAULT_CAL;
  }
  return cal;
}
