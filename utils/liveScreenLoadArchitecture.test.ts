/**
 * Live tab load architecture invariants (mirrors app/(tabs)/live.tsx).
 * Run: npx tsx utils/liveScreenLoadArchitecture.test.ts
 */

import assert from "node:assert/strict";

type MiniRace = { id: string; label: string };

/** Mirrors live.tsx mergeLiveById: primary wins on duplicate id. */
function mergeLiveById(primary: MiniRace[], extra: MiniRace[]): MiniRace[] {
  const seen = new Set(primary.map((r) => r.id));
  const out = [...primary];
  for (const r of extra) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

async function main() {
  const classic = [
    { id: "c1", label: "classic-1" },
    { id: "c2", label: "classic-2" },
  ];
  const unlimited = [{ id: "u1", label: "unlimited-1" }];
  assert.deepEqual(
    mergeLiveById(classic, unlimited).map((r) => r.id),
    ["c1", "c2", "u1"],
    "classic + unlimited merge must keep classic rows",
  );

  let painted: MiniRace[] = [{ id: "c1", label: "classic" }];
  painted = mergeLiveById(painted, [{ id: "u1", label: "ul" }]);
  assert.deepEqual(
    painted.map((r) => r.id),
    ["c1", "u1"],
    "progressive classic-first then merge must not blank",
  );

  let gen = 0;
  let live: string[] = [];
  const run = (myGen: number, rows: string[]) => {
    if (myGen !== gen) return;
    live = rows;
  };
  const g1 = ++gen;
  const g2 = ++gen;
  run(g1, ["stale"]);
  run(g2, ["fresh"]);
  assert.deepEqual(live, ["fresh"], "stale load generation must discard late paint");

  const dup = mergeLiveById([{ id: "1", label: "classic" }], [{ id: "1", label: "unlimited" }]);
  assert.equal(dup.length, 1);
  assert.equal(dup[0]?.label, "classic", "primary wins on duplicate id");

  const events: string[] = [];
  const disk = new Promise<string>((resolve) => {
    setTimeout(() => {
      events.push("disk");
      resolve("disk");
    }, 30);
  });
  const network = Promise.resolve().then(() => {
    events.push("network-start");
    return "network";
  });
  void disk;
  await network;
  assert.equal(events[0], "network-start", "network must start without awaiting disk");
  await disk;
  assert.deepEqual(events, ["network-start", "disk"]);

  console.log("liveScreenLoadArchitecture.test.ts: all assertions passed");
}

void main();
