/**
 * Direct unit tests for ChannelRefCounter.
 * Run: npx tsx services/channelRefCount.test.ts
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
assert.deepEqual(counter.names(), ["ch-a"]);

// Two subscribers share same resource (create not called again)
let created = 0;
const shared = new ChannelRefCounter<{ id: string; n: number }>();
const first = shared.acquire("shared", () => {
  created += 1;
  return { id: "shared", n: created };
});
const second = shared.acquire("shared", () => {
  created += 1;
  return { id: "SHOULD_NOT", n: 99 };
});
assert.equal(created, 1);
assert.equal(shared.count("shared"), 2);
assert.equal(first, second);
assert.equal(first?.n, 1);

// Remove one — channel remains
destroyed.length = 0;
shared.release("shared", (n) => destroyed.push(n));
assert.equal(shared.count("shared"), 1);
assert.deepEqual(destroyed, []);

// Remove final — destroy fires once
shared.release("shared", (n) => destroyed.push(n));
assert.equal(shared.count("shared"), 0);
assert.deepEqual(destroyed, ["shared"]);
assert.deepEqual(shared.names(), []);

// clear / logout destroys all
const logout = new ChannelRefCounter<{ id: string }>();
assert.ok(logout.acquire("x", () => create("x")));
assert.ok(logout.acquire("y", () => create("y")));
assert.ok(logout.acquire("x", () => create("SHOULD_NOT")));
assert.equal(logout.count("x"), 2);
destroyed.length = 0;
logout.clear((names) => {
  destroyed.push(...names.sort());
});
assert.equal(logout.count("x"), 0);
assert.equal(logout.count("y"), 0);
assert.deepEqual(destroyed, ["x", "y"]);
assert.deepEqual(logout.names(), []);

// create returning null does not retain
assert.equal(counter.acquire("nullish", () => null), null);
assert.equal(counter.count("nullish"), 0);

console.log("channelRefCount.test.ts — all assertions passed");
