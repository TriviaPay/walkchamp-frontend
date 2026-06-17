import { Platform } from "react-native";

let _cached: string | null = null;

/**
 * Returns the API base URL to prefix relative paths with.
 *
 * - When EXPO_PUBLIC_API_URL is set: used on all platforms (required for split
 *   frontend/backend deployments and native builds).
 * - Web fallback: returns "" so relative /api paths resolve against the page
 *   origin (same-origin reverse-proxy setups).
 */
export function getApiBase(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl) {
    if (_cached === null) {
      _cached = envUrl.replace(/\/$/, "");
    }
    return _cached;
  }

  if (Platform.OS === "web") return "";

  if (_cached === null) {
    _cached = "";
  }
  return _cached;
}
