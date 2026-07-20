/**
 * Remote track theme media (R2) — shared types + URL resolution.
 * Local fallbacks: only `bg` and `daylightStadium` remain bundled.
 * All other codes load via GET /api/track-themes/:code/image.
 */

import type { ImageSource } from "expo-image";
import {
  LOCAL_TRACK_FALLBACKS,
  type LocalTrackFallbackId,
} from "@/constants/trackLayouts";
import { trackThemeImageUri, buildApiImageUri } from "@/services/mediaApi";

export type TrackThemeImageSet = {
  thumb: string;
  preview: string;
  full: string;
};

export type TrackThemeMedia = {
  code: string;
  assetVersion: number;
  width: number;
  height: number;
  imageSet: TrackThemeImageSet | null;
  /** Backward-compatible alias to imageSet.preview when R2 is configured. */
  imageUrl: string;
};

export type TrackThemeImageVariant = "thumb" | "preview" | "full";

/** Fields that may appear on themes, races, or rooms from the API. */
export type TrackThemeMediaFields = {
  code?: string | null;
  trackLayout?: string | null;
  assetVersion?: number | null;
  width?: number | null;
  height?: number | null;
  imageSet?: TrackThemeImageSet | null;
  imageUrl?: string | null;
};

function absolutizeMediaUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith("file:")) {
    return trimmed;
  }
  // Backend returns paths like `/api/track-themes/forest/image`
  if (trimmed.startsWith("/")) {
    return buildApiImageUri(trimmed);
  }
  return trimmed;
}

function pickRemoteUrl(
  media: TrackThemeMediaFields | null | undefined,
  variant: TrackThemeImageVariant,
): string | null {
  if (!media) return null;
  const set = media.imageSet;
  if (set) {
    const url = set[variant]?.trim();
    if (url) return absolutizeMediaUrl(url);
    // Prefer higher-quality fallback within the set when a variant is missing.
    const cascade =
      variant === "thumb"
        ? [set.thumb, set.preview, set.full]
        : variant === "preview"
          ? [set.preview, set.full, set.thumb]
          : [set.full, set.preview, set.thumb];
    for (const u of cascade) {
      if (u?.trim()) return absolutizeMediaUrl(u.trim());
    }
  }
  const legacy = media.imageUrl?.trim();
  return legacy ? absolutizeMediaUrl(legacy) : null;
}

function localFallbackForCode(code: string | null | undefined): number {
  const key = (code ?? "bg").trim() as LocalTrackFallbackId;
  if (key in LOCAL_TRACK_FALLBACKS) {
    return LOCAL_TRACK_FALLBACKS[key];
  }
  return LOCAL_TRACK_FALLBACKS.bg;
}

function hasBundledAsset(code: string | null | undefined): boolean {
  const key = (code ?? "").trim();
  return key.length > 0 && key in LOCAL_TRACK_FALLBACKS;
}

/** Stable disk key so list preview + race full share one cache entry when URI matches. */
function cacheKeyFor(code: string, uri: string, assetVersion?: number | null): string {
  if (assetVersion != null && Number.isFinite(Number(assetVersion))) {
    return `theme:${code}:v${assetVersion}`;
  }
  return uri.split("?")[0] || `theme:${code}`;
}

/**
 * Resolve expo-image source for a theme/race/room.
 * Prefer R2 / imageSet / imageUrl; else API proxy for non-bundled codes;
 * else bundled bg / daylightStadium.
 */
export function resolveTrackThemeImageSource(
  media: TrackThemeMediaFields | null | undefined,
  variant: TrackThemeImageVariant,
): ImageSource | number {
  const code = String(media?.code ?? media?.trackLayout ?? "bg").trim() || "bg";
  const remote = pickRemoteUrl(media, variant);
  if (remote) {
    return {
      uri: remote,
      cacheKey: cacheKeyFor(code, remote, media?.assetVersion),
    };
  }

  // Live races only send trackLayout — synthesize the public theme image URL
  // so premium themes still load after local PNGs were removed.
  if (!hasBundledAsset(code)) {
    const uri = trackThemeImageUri(
      code,
      media?.assetVersion != null ? Number(media.assetVersion) : undefined,
    );
    return {
      uri,
      cacheKey: cacheKeyFor(code, uri, media?.assetVersion),
    };
  }

  return localFallbackForCode(code);
}

export function trackThemeCodeOf(
  media: TrackThemeMediaFields | null | undefined,
): string {
  return String(media?.code ?? media?.trackLayout ?? "bg").trim() || "bg";
}

/** True when the resolved source is a remote URI (needs network / disk cache). */
export function isRemoteTrackThemeSource(
  source: ImageSource | number,
): source is ImageSource & { uri: string } {
  return typeof source === "object" && !!source && "uri" in source && typeof source.uri === "string";
}
