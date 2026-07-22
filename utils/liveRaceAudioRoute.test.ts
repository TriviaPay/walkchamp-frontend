/**
 * Characterization tests for Live Race audio-route pure logic.
 * Run: npx tsx utils/liveRaceAudioRoute.test.ts
 */

import assert from "node:assert/strict";
import {
  androidPreferredOutputList,
  decideRouteApply,
  isBluetoothOutputAvailable,
  isEarpieceOutputAvailable,
  routeAfterBluetoothDisconnect,
  selectOutputDeviceId,
  shouldReplacePendingRoute,
} from "./liveRaceAudioRoute";

function eq(a: unknown, b: unknown, label: string): void {
  assert.equal(a, b, label);
}

// Default / preference lists — selected route MUST be first
eq(androidPreferredOutputList("speaker")[0], "speaker", "speaker first");
eq(androidPreferredOutputList("phone")[0], "earpiece", "earpiece first for phone");
eq(androidPreferredOutputList("bluetooth")[0], "bluetooth", "bluetooth first");

// Regression: old speaker list preferred headset/bluetooth over speaker
assert.notEqual(
  androidPreferredOutputList("speaker")[0],
  "headset",
  "speaker must not prefer headset first",
);
assert.notEqual(
  androidPreferredOutputList("speaker")[0],
  "bluetooth",
  "speaker must not prefer bluetooth first",
);

// selectAudioOutput device ids
eq(selectOutputDeviceId("speaker", "android"), "speaker", "android speaker id");
eq(selectOutputDeviceId("phone", "android"), "earpiece", "android earpiece id");
eq(selectOutputDeviceId("bluetooth", "android"), "bluetooth", "android bt id");
eq(selectOutputDeviceId("speaker", "ios"), "force_speaker", "ios force speaker");
eq(selectOutputDeviceId("phone", "ios"), "default", "ios phone default");
eq(selectOutputDeviceId("bluetooth", "ios"), "default", "ios bt uses default");

// Availability
eq(isBluetoothOutputAvailable(["speaker", "bluetooth"]), true, "bt available");
eq(isBluetoothOutputAvailable(["speaker", "earpiece"]), false, "bt missing");
eq(isBluetoothOutputAvailable(["Bluetooth SCO"]), true, "bt case-insensitive");
eq(isEarpieceOutputAvailable(["speaker", "earpiece"], "android"), true, "earpiece ok");
eq(isEarpieceOutputAvailable(["speaker"], "android"), false, "earpiece missing android");
eq(isEarpieceOutputAvailable(["force_speaker"], "ios"), true, "ios earpiece soft-allow");

// Decide apply
{
  const denied = decideRouteApply({
    requested: "bluetooth",
    bluetoothAvailable: false,
    earpieceAvailable: true,
    current: "speaker",
  });
  eq(denied.ok, false, "bt denied");
  if (!denied.ok) {
    eq(denied.route, "speaker", "keep current on bt deny");
    eq(denied.reason, "bluetooth_unavailable", "bt reason");
  }

  const earDeny = decideRouteApply({
    requested: "phone",
    bluetoothAvailable: false,
    earpieceAvailable: false,
    current: "speaker",
  });
  eq(earDeny.ok, false, "earpiece denied");

  const ok = decideRouteApply({
    requested: "speaker",
    bluetoothAvailable: true,
    earpieceAvailable: true,
    current: "phone",
  });
  eq(ok.ok, true, "speaker ok");
  if (ok.ok) eq(ok.route, "speaker", "speaker applied");
}

// BT disconnect fallback
eq(routeAfterBluetoothDisconnect("bluetooth", false), "speaker", "bt drop → speaker");
eq(routeAfterBluetoothDisconnect("bluetooth", true), "bluetooth", "bt still ok");
eq(routeAfterBluetoothDisconnect("speaker", false), "speaker", "speaker unchanged");
eq(routeAfterBluetoothDisconnect("phone", false), "phone", "phone unchanged");

// Rapid / latest-wins
eq(shouldReplacePendingRoute(null, "speaker"), true, "null pending");
eq(shouldReplacePendingRoute("speaker", "speaker"), false, "duplicate ignored");
eq(shouldReplacePendingRoute("speaker", "phone"), true, "replace with phone");

// Rapid sequence ends on latest distinct
{
  let pending: "speaker" | "phone" | "bluetooth" | null = null;
  for (const next of ["speaker", "phone", "bluetooth", "speaker"] as const) {
    if (shouldReplacePendingRoute(pending, next)) pending = next;
  }
  eq(pending, "speaker", "latest selection wins");
}

console.log("liveRaceAudioRoute.test.ts — all assertions passed");
