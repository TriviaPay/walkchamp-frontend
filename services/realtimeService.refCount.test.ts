/**
 * Characterization tests for channel subscription reference counting.
 * Run: npx tsx services/realtimeService.refCount.test.ts
 */

import assert from "node:assert/strict";
import { ChannelRefCounter } from "./channelRefCount";

const destroyed: string[] = [];
const counter = new ChannelRefCounter<{ id: string }>();

function create(name: string) {
  return { id: name };
}

// One subscriber
assert.equal(counter.acquire("ch-a", () => create("ch-a"))?.id, "ch-a");
assert.equal(counter.count("ch-a"), 1);

// Two subscribers share same resource
const second = counter.acquire("ch-a", () => create("SHOULD_NOT_CREATE"));
assert.equal(second?.id, "ch-a");
assert.equal(counter.count("ch-a"), 2);

// One removed — channel remains
counter.release("ch-a", (n) => destroyed.push(n));
assert.equal(counter.count("ch-a"), 1);
assert.deepEqual(destroyed, []);

// Final removed — destroy fires once
counter.release("ch-a", (n) => destroyed.push(n));
assert.equal(counter.count("ch-a"), 0);
assert.deepEqual(destroyed, ["ch-a"]);

// Release unknown still calls destroy (legacy cleanup)
destroyed.length = 0;
counter.release("missing", (n) => destroyed.push(n));
assert.deepEqual(destroyed, ["missing"]);

// clear destroys all
assert.ok(counter.acquire("x", () => create("x")));
assert.ok(counter.acquire("y", () => create("y")));
destroyed.length = 0;
counter.clear((names) => {
  destroyed.push(...names.sort());
});
assert.equal(counter.count("x"), 0);
assert.equal(counter.count("y"), 0);
assert.deepEqual(destroyed, ["x", "y"]);

// create returning null does not retain
assert.equal(counter.acquire("nullish", () => null), null);
assert.equal(counter.count("nullish"), 0);

console.log("realtimeService.refCount.test.ts — all assertions passed");
