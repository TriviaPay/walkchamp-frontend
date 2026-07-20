import { useMemo } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store";
import {
  TRACK_LAYOUT_OPTIONS,
  FREE_TRACK_CODES,
  getTrackThemeLabel,
} from "@/constants/trackLayouts";
import type { TrackThemeMediaFields } from "@/utils/trackThemeMedia";

export type OwnedTrackLayout = {
  id: string;
  label: string;
  media: TrackThemeMediaFields;
};

/**
 * Owned themes for race/host pickers.
 * Prefers Redux catalog (remote imageSet); falls back to bundled free themes while loading.
 */
export function useOwnedTrackLayouts(): {
  layouts: OwnedTrackLayout[];
  isLoading: boolean;
} {
  const themes = useSelector((s: RootState) => s.trackThemes.themes);

  return useMemo(() => {
    if (!themes.length) {
      return {
        layouts: TRACK_LAYOUT_OPTIONS.map((l) => ({
          id: l.id,
          label: l.label,
          media: { code: l.id, trackLayout: l.id },
        })),
        isLoading: true,
      };
    }

    const layouts = themes
      .filter((t) => t.owned || FREE_TRACK_CODES.has(t.code) || t.isDefault)
      .map((t) => ({
        id: t.code,
        label: getTrackThemeLabel(t.code, t.name),
        media: {
          code: t.code,
          trackLayout: t.code,
          imageSet: t.imageSet ?? null,
          imageUrl: t.imageUrl ?? null,
          assetVersion: t.assetVersion,
          width: t.width,
          height: t.height,
        } satisfies TrackThemeMediaFields,
      }));

    if (layouts.length === 0) {
      return {
        layouts: TRACK_LAYOUT_OPTIONS.filter((l) => FREE_TRACK_CODES.has(l.id)).map((l) => ({
          id: l.id,
          label: l.label,
          media: { code: l.id, trackLayout: l.id },
        })),
        isLoading: false,
      };
    }

    return { layouts, isLoading: false };
  }, [themes]);
}
