import {
  extractErrorMessage,
  mapApiErrorBody,
  toUserFacingError,
} from "./userFacingError";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  toUserFacingError(new Error("Network request failed"), "wallet").includes("connect"),
  "network pattern maps to connectivity message",
);

assert(
  toUserFacingError(new Error("Not authenticated"), "generic").includes("session"),
  "auth pattern maps to session message",
);

assert(
  toUserFacingError(new Error("Error: boom\n    at LiveRaceScreen.tsx:123:45"), "generic") ===
    "Something went wrong. Please try again.",
  "stack traces are sanitized",
);

assert(
  mapApiErrorBody({ error: "Insufficient balance" }) === "Insufficient balance",
  "safe API errors pass through",
);

assert(
  extractErrorMessage({ message: "hello" }) === "hello",
  "object message extraction",
);

console.log("userFacingError.test.ts: ok");
