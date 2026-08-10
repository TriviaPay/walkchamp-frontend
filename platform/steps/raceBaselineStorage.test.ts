/**
 * Unit tests for race baseline isolation.
 * Requires: npx tsx --require ./scripts/mock-async-storage.cjs ...
 */

import assert from "node:assert/strict";
import {
  clearRaceBaseline,
  getRaceBaseline,
  getRaceStepSeed,
  setRaceBaseline,
  setRaceStepSeed,
} from "./raceBaselineStorage";
import { storageSet } from "@/utils/storage";

type AsyncStorageMock = {
  __reset: () => void;
};

function resetStore(): void {
  const mock = (globalThis as { __ASYNC_STORAGE_MOCK__?: AsyncStorageMock })
    .__ASYNC_STORAGE_MOCK__;
  assert.ok(mock, "AsyncStorage mock preload missing — use --require ./scripts/mock-async-storage.cjs");
  mock.__reset();
}

async function run() {
  resetStore();

  // Save + read
  await setRaceBaseline("race-a", "user-1", "android_legacy_sensor", 1000);
  assert.equal(
    await getRaceBaseline("race-a", "user-1", "android_legacy_sensor"),
    1000,
  );

  // Missing baseline
  assert.equal(
    await getRaceBaseline("race-missing", "user-1", "android_legacy_sensor"),
    null,
  );

  // Isolation across races and users
  await setRaceBaseline("race-b", "user-1", "android_legacy_sensor", 2500);
  await setRaceBaseline("race-a", "user-2", "android_legacy_sensor", 777);
  assert.equal(
    await getRaceBaseline("race-a", "user-1", "android_legacy_sensor"),
    1000,
  );
  assert.equal(
    await getRaceBaseline("race-b", "user-1", "android_legacy_sensor"),
    2500,
  );
  assert.equal(
    await getRaceBaseline("race-a", "user-2", "android_legacy_sensor"),
    777,
  );

  // Remove one race baseline
  await clearRaceBaseline("race-a", "user-1", "android_legacy_sensor");
  assert.equal(
    await getRaceBaseline("race-a", "user-1", "android_legacy_sensor"),
    null,
  );
  assert.equal(
    await getRaceBaseline("race-b", "user-1", "android_legacy_sensor"),
    2500,
  );

  // Invalid stored JSON → treated as missing
  resetStore();
  const mock = (globalThis as { __ASYNC_STORAGE_MOCK__?: { __store: Map<string, string> } })
    .__ASYNC_STORAGE_MOCK__;
  assert.ok(mock);
  mock.__store.set(
    "raceBaseline:user-1:race-x:android_legacy_sensor",
    "{not-json",
  );
  assert.equal(
    await getRaceBaseline("race-x", "user-1", "android_legacy_sensor"),
    null,
  );

  // Legacy key migration
  resetStore();
  await storageSet("raceSteps:user-1:race-legacy:android_legacy_sensor", {
    raceId: "race-legacy",
    userId: "user-1",
    providerId: "android_legacy_sensor",
    baselineSteps: 333,
    createdAt: new Date().toISOString(),
  });
  assert.equal(
    await getRaceBaseline("race-legacy", "user-1", "android_legacy_sensor"),
    333,
  );
  // Migrated value remains readable from new key
  assert.equal(
    await getRaceBaseline("race-legacy", "user-1", "android_legacy_sensor"),
    333,
  );

  // Seed persistence (app restart simulation)
  resetStore();
  await setRaceStepSeed("race-s", "user-1", 42);
  assert.equal(await getRaceStepSeed("race-s", "user-1"), 42);
  await setRaceBaseline("race-s", "user-1", "ios_healthkit", 900);
  assert.equal(await getRaceBaseline("race-s", "user-1", "ios_healthkit"), 900);

  console.log("raceBaselineStorage.test.ts — all passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
