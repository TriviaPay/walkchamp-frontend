import assert from "node:assert/strict";
import {
  ROOM_ACCENT_THEMES,
  selectCreateChallengeAccentTheme,
} from "../constants/createChallengeTheme";
import { createDefaultDraft } from "./createChallengeFlow";

const publicTheme = selectCreateChallengeAccentTheme("public");
const privateTheme = selectCreateChallengeAccentTheme("private");

assert.equal(publicTheme.key, "public");
assert.equal(privateTheme.key, "private");
assert.equal(publicTheme.primary, "#166DFF");
assert.equal(publicTheme.secondary, "#08D7FF");
assert.equal(publicTheme.border, "#13C8FF");
assert.deepEqual([...publicTheme.gradientSelected], ["#086A9A", "#0E4F91", "#3239A7"]);
assert.deepEqual([...publicTheme.gradientCta], ["#0A8DDA", "#2455E8", "#673AD7"]);

assert.equal(privateTheme.primary, "#8642FF");
assert.equal(privateTheme.secondary, "#A93BFF");
assert.equal(privateTheme.tertiary, "#EA18D8");
assert.equal(privateTheme.border, "#C53FFF");
assert.deepEqual([...privateTheme.gradientSelected], ["#3D247B", "#7028A7", "#B21AC5"]);
assert.deepEqual([...privateTheme.gradientCta], ["#4A48E0", "#9C2DDB", "#E01ACC"]);

// Full-bleed selected surfaces — three stops, no nested panel tokens
assert.equal(publicTheme.gradientSelected.length, 3);
assert.equal(privateTheme.gradientSelected.length, 3);

assert.notEqual(publicTheme.primary, privateTheme.primary);
assert.notEqual(publicTheme.gradientCta[0], privateTheme.gradientCta[0]);

// Same object identity from map
assert.equal(selectCreateChallengeAccentTheme("public"), ROOM_ACCENT_THEMES.public);
assert.equal(selectCreateChallengeAccentTheme("private"), ROOM_ACCENT_THEMES.private);

// Changing room visibility must not reset challenge draft values
const draft = createDefaultDraft();
draft.usdFormat = "unlimited_goal";
draft.unlimited.entryDollars = 250;
draft.unlimited.dailyGoalSteps = 12000;
draft.fixed.usdAmountDollars = 15;
draft.entryType = "usd";
const saved = {
  entry: draft.unlimited.entryDollars,
  goal: draft.unlimited.dailyGoalSteps,
  fixedEntry: draft.fixed.usdAmountDollars,
  format: draft.usdFormat,
  entryType: draft.entryType,
};
draft.visibility = "private";
assert.equal(draft.unlimited.entryDollars, saved.entry);
assert.equal(draft.unlimited.dailyGoalSteps, saved.goal);
assert.equal(draft.fixed.usdAmountDollars, saved.fixedEntry);
assert.equal(draft.usdFormat, saved.format);
assert.equal(draft.entryType, saved.entryType);
assert.equal(selectCreateChallengeAccentTheme(draft.visibility).key, "private");

draft.visibility = "public";
assert.equal(selectCreateChallengeAccentTheme(draft.visibility).key, "public");
assert.equal(draft.unlimited.entryDollars, 250);

console.log("createChallengeRoomTheme.test.ts: ok");
