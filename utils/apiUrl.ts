import { Platform } from "react-native";

let _cached: string | null = null;

/** Same production host as eas.json — used when local `.env` is missing after a fresh pull. */
const API_URL_FALLBACK = "https://api.walkchamp.miragaming.com";

/**
 * Returns the API base URL to prefix relative paths with.
 *
 * - When EXPO_PUBLIC_API_URL is set: used on all platforms (required for split
 *   frontend/backend deployments and native builds).
 * - Native fallback: production API host so signup/profile still work without a
 *   local `.env` (mirrors Descope project-id fallback).
 * - Web fallback: returns "" so relative /api paths resolve against the page
 *   origin (same-origin reverse-proxy setups).
 */
export function getApiBase(): string {
  if (_cached !== null) return _cached;

  const envUrl = (process.env.EXPO_PUBLIC_API_URL ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/$/, "");

  if (envUrl) {
    _cached = envUrl;
    return _cached;
  }

  if (Platform.OS === "web") {
    _cached = "";
    return _cached;
  }

  _cached = API_URL_FALLBACK;
  return _cached;
}
