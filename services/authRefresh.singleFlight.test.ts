/**
 * Characterization: refreshSessionSafely single-flight + failure modes.
 * Run: npx tsx --require ./scripts/mock-auth-node.cjs services/authRefresh.singleFlight.test.ts
 */

import assert from "node:assert/strict";
import {
  clearSession,
  refreshSessionSafely,
  saveSession,
  SESSION_KEY,
  REFRESH_KEY,
} from "./authService";

type SecureStoreMock = {
  __reset: () => void;
  __store: Map<string, string>;
  setItemAsync: (key: string, value: string) => Promise<void>;
};

function b64url(obj: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(obj), "utf8")
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

/** Minimal unsigned JWT with iat/exp for client-side expiry checks. */
function makeJwt(secsUntilExp: number, lifetimeSecs = 86_400): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + secsUntilExp;
  const iat = exp - lifetimeSecs;
  return `${b64url({ alg: "none", typ: "JWT" })}.${b64url({
    sub: "user-test",
    iat,
    exp,
  })}.sig`;
}

function getSecureMock(): SecureStoreMock {
  const mock = (globalThis as { __SECURE_STORE_MOCK__?: SecureStoreMock })
    .__SECURE_STORE_MOCK__;
  assert.ok(mock, "SecureStore mock missing — use --require ./scripts/mock-auth-node.cjs");
  return mock;
}

async function resetAuthState(): Promise<void> {
  const mock = getSecureMock();
  mock.__reset();
  await clearSession();
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  let refreshCalls = 0;

  try {
    // ── Concurrent callers share one refresh ────────────────────────────────
    await resetAuthState();
    const refreshJwt = makeJwt(30 * 86_400, 30 * 86_400);
    const sessionJwt = makeJwt(60, 3600);
    await saveSession(sessionJwt, refreshJwt);

    refreshCalls = 0;
    let resolveRefresh!: (v: Response) => void;
    const refreshGate = new Promise<Response>((r) => {
      resolveRefresh = r;
    });
    let resolveStarted!: () => void;
    const refreshStarted = new Promise<void>((r) => {
      resolveStarted = r;
    });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/auth/session/refresh")) {
        refreshCalls += 1;
        resolveStarted();
        const body = await refreshGate;
        return body;
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const p1 = refreshSessionSafely();
    const p2 = refreshSessionSafely();
    const p3 = refreshSessionSafely();

    await refreshStarted;
    // Give joiners a tick to attach to the shared promise
    await Promise.resolve();
    assert.equal(refreshCalls, 1, "concurrent refreshSessionSafely share one network call");

    const newSession = makeJwt(3600, 3600);
    const newRefresh = makeJwt(30 * 86_400, 30 * 86_400);
    resolveRefresh(
      new Response(
        JSON.stringify({ sessionJwt: newSession, refreshJwt: newRefresh }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const [o1, o2, o3] = await Promise.all([p1, p2, p3]);
    assert.equal(refreshCalls, 1, "still exactly one refresh after joiners settle");
    assert.equal(o1.ok, true);
    assert.equal(o2.ok, true);
    assert.equal(o3.ok, true);
    if (o1.ok && o2.ok && o3.ok) {
      assert.equal(o1.token, newSession);
      assert.equal(o2.token, newSession);
      assert.equal(o3.token, newSession);
    }

    // ── Definitive failure (4xx from refresh API) ───────────────────────────
    await resetAuthState();
    await saveSession(makeJwt(60, 3600), makeJwt(30 * 86_400, 30 * 86_400));
    refreshCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/session/refresh")) {
        refreshCalls += 1;
        return new Response(
          JSON.stringify({ error: "invalid grant", message: "refresh rejected" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const definitive = await refreshSessionSafely();
    assert.equal(definitive.ok, false);
    if (!definitive.ok) {
      assert.equal(definitive.definitive, true, "4xx refresh is definitive");
    }
    assert.equal(refreshCalls, 1);

    // Session cleared after definitive failure (web memStore + SecureStore mock)
    const mock = getSecureMock();
    assert.equal(mock.__store.has(SESSION_KEY), false);
    assert.equal(mock.__store.has(REFRESH_KEY), false);

    // ── Temporary network failure (keep session) ────────────────────────────
    await resetAuthState();
    const keepSession = makeJwt(60, 3600);
    const keepRefresh = makeJwt(30 * 86_400, 30 * 86_400);
    await saveSession(keepSession, keepRefresh);
    refreshCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/auth/session/refresh")) {
        refreshCalls += 1;
        throw new TypeError("Network request failed");
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const transient = await refreshSessionSafely();
    assert.equal(transient.ok, false);
    if (!transient.ok) {
      assert.equal(transient.definitive, false, "network error is transient");
    }
    assert.equal(refreshCalls, 1);
    // Tokens remain after transient failure (Platform.OS=web uses memStore inside authService;
    // saveSession also wrote to SecureStore mock — at least memory path kept user logged in).
    // Re-save check: a subsequent refresh can still attempt (not logged out).
    const again = await refreshSessionSafely();
    assert.equal(again.ok, false);
    if (!again.ok) assert.equal(again.definitive, false);
    assert.equal(refreshCalls, 2, "transient failure allows another refresh attempt");

    // ── No refresh token → definitive ───────────────────────────────────────
    await resetAuthState();
    // Force empty session state
    const empty = await refreshSessionSafely();
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.equal(empty.definitive, true);

    console.log("authRefresh.singleFlight.test.ts — all assertions passed");
  } finally {
    globalThis.fetch = originalFetch;
    await resetAuthState().catch(() => {});
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
