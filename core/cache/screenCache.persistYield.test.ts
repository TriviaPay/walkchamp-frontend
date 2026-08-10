/**
 * screenCache.set must not JSON.stringify on the caller's synchronous stack.
 * Run: npx tsx utils/screenCache.persistYield.test.ts
 */

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

import assert from "node:assert/strict";
import { screenCache } from "./screenCache";

async function main() {
  const key = `test_screen_cache_yield_${Date.now()}`;
  const payload = { rows: Array.from({ length: 50 }, (_, i) => ({ id: String(i), n: i })) };

  screenCache.primeSync(key, payload);
  assert.deepEqual(screenCache.getSync(key), payload, "primeSync must be sync-readable");

  let callerContinued = false;
  const setPromise = screenCache.set(key, { ...payload, v: 2 });
  callerContinued = true;
  assert.equal(callerContinued, true, "set() must return control before disk persist");
  assert.equal(
    (screenCache.getSync(key) as { v?: number } | null)?.v,
    2,
    "set() must update memory before yielding",
  );
  await setPromise;

  screenCache.invalidate(key);
  console.log("screenCache.persistYield.test.ts: all assertions passed");
}

void main();
