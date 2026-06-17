import { useSelector } from "react-redux";
import type { RootState } from "@/store";
import { TRACK_LAYOUT_OPTIONS, FREE_TRACK_CODES } from "@/constants/trackLayouts";

export function useOwnedTrackLayouts() {
  const themes = useSelector((s: RootState) => s.trackThemes.themes);

  const layouts = TRACK_LAYOUT_OPTIONS.filter((layout) => {
    const themeData = themes.find((t) => t.code === layout.id);
    return themeData?.owned ?? FREE_TRACK_CODES.has(layout.id);
  });

  // If Redux themes not yet loaded, fall back to the free tracks so the
  // carousel always shows something while the store hydrates.
  if (layouts.length === 0) {
    return {
      layouts: TRACK_LAYOUT_OPTIONS.filter((l) => FREE_TRACK_CODES.has(l.id)),
      isLoading: true,
    };
  }

  return { layouts, isLoading: false };
}
