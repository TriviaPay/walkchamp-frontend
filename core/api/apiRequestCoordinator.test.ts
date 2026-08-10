/**
 * Unit tests for API request coordinator (dedupe / TTL gates).
 * Run: npx tsx core/api/apiRequestCoordinator.test.ts
 */

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import assert from "node:assert/strict";
import {
  runCoalesced,
  runCoalescedAuthed,
  apiFetchAllowed,
  markApiFetched,
  resetApiFetchGate,
} from "./apiRequestCoordinator";
import { bumpAuthGeneration } from "@/services/authSessionGeneration";

async function main() {
  resetApiFetchGate();

  let runs = 0;
  const tasks = Array.from({ length: 10 }, () =>
    runCoalesced("test:dedupe", async () => {
      runs += 1;
      await new Promise((r) => setTimeout(r, 20));
      return "ok";
    }),
  );
  const results = await Promise.all(tasks);
  assert.equal(runs, 1, "10 concurrent coalesced calls must share one execution");
  assert.ok(results.every((r) => r === "ok"));

  resetApiFetchGate("leaderboard");
  assert.equal(apiFetchAllowed("leaderboard_tab_focus", 30_000), true);
  markApiFetched("leaderboard_tab_focus");
  assert.equal(apiFetchAllowed("leaderboard_tab_focus", 30_000), false);

  // Authed coalesce drops when generation bumps mid-flight.
  bumpAuthGeneration();
  const dropped = await runCoalescedAuthed(null as unknown as string, null, async () => "x");
  assert.equal(dropped, undefined, "null userId must not run");

  console.log("apiRequestCoordinator.test.ts: all assertions passed");
}

void main();

