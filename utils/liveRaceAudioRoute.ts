/**
 * Pure Live Race audio-route selection helpers.
 * Route preference is independent of microphone mute (mic mute stays separate).
 */

export const LIVE_RACE_AUDIO_ROUTES = ["speaker", "phone", "bluetooth"] as const;

export type LiveRaceAudioRoute = (typeof LIVE_RACE_AUDIO_ROUTES)[number];

/** Android LiveKit preferredOutputList — selected route first. */
export function androidPreferredOutputList(
  route: LiveRaceAudioRoute,
): Array<"speaker" | "earpiece" | "headset" | "bluetooth"> {
  switch (route) {
    case "speaker":
      return ["speaker", "headset", "earpiece", "bluetooth"];
    case "bluetooth":
      return ["bluetooth", "headset", "speaker", "earpiece"];
    case "phone":
    default:
      return ["earpiece", "headset", "speaker", "bluetooth"];
  }
}

/**
 * Device id for AudioSession.selectAudioOutput.
 * Android: speaker | earpiece | headset | bluetooth
 * iOS: force_speaker | default (OS may pick BT/headset when default)
 */
export function selectOutputDeviceId(
  route: LiveRaceAudioRoute,
  platform: "ios" | "android" | "web" | string,
): string {
  if (platform === "ios") {
    return route === "speaker" ? "force_speaker" : "default";
  }
  if (route === "speaker") return "speaker";
  if (route === "bluetooth") return "bluetooth";
  return "earpiece";
}

export function isBluetoothOutputAvailable(outputs: string[]): boolean {
  return outputs.some((o) => o.toLowerCase().includes("bluetooth"));
}

export function isEarpieceOutputAvailable(
  outputs: string[],
  platform: "ios" | "android" | "web" | string,
): boolean {
  if (platform === "ios") return true; // receiver available on phones; fail soft natively
  if (outputs.length === 0) return true; // unknown — allow attempt
  return outputs.some((o) => o.toLowerCase() === "earpiece");
}

export type RouteApplyRequest = {
  requested: LiveRaceAudioRoute;
  bluetoothAvailable: boolean;
  earpieceAvailable: boolean;
  current: LiveRaceAudioRoute;
};

export type RouteApplyDecision =
  | { ok: true; route: LiveRaceAudioRoute }
  | {
      ok: false;
      route: LiveRaceAudioRoute;
      reason: "bluetooth_unavailable" | "earpiece_unavailable";
      message: string;
    };

/** Decide whether a user route request should proceed (pure). */
export function decideRouteApply(req: RouteApplyRequest): RouteApplyDecision {
  if (req.requested === "bluetooth" && !req.bluetoothAvailable) {
    return {
      ok: false,
      route: req.current,
      reason: "bluetooth_unavailable",
      message: "No Bluetooth audio device is connected.",
    };
  }
  if (req.requested === "phone" && !req.earpieceAvailable) {
    return {
      ok: false,
      route: req.current,
      reason: "earpiece_unavailable",
      message: "Phone audio is not available on this device.",
    };
  }
  return { ok: true, route: req.requested };
}

/** When BT drops while selected, fall back to speaker. */
export function routeAfterBluetoothDisconnect(
  current: LiveRaceAudioRoute,
  bluetoothAvailable: boolean,
): LiveRaceAudioRoute {
  if (current === "bluetooth" && !bluetoothAvailable) return "speaker";
  return current;
}

/** Latest-wins: whether candidate should replace in-flight pending. */
export function shouldReplacePendingRoute(
  pending: LiveRaceAudioRoute | null,
  candidate: LiveRaceAudioRoute,
): boolean {
  if (!pending) return true;
  return pending !== candidate;
}

export function isLiveRaceAudioRoute(value: unknown): value is LiveRaceAudioRoute {
  return (
    typeof value === "string" &&
    (LIVE_RACE_AUDIO_ROUTES as readonly string[]).includes(value)
  );
}
