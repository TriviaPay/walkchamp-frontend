/**
 * Characterization: authFetch retryOnUnauthorized must not re-POST body after 401.
 * Run: npx tsx --require ./scripts/mock-auth-fetch-node.cjs utils/authFetch.retryPolicy.test.ts
 */

import assert from "node:assert/strict";
import { authFetch } from "./authFetch";

type AuthStub = {
  getValidSession: () => Promise<string | null>;
  refreshSessionSafely: () => Promise<
    { ok: true; token: string } | { ok: false; definitive: boolean }
  >;
  __calls: { getValidSession: number; refreshSessionSafely: number };
};

function getStub(): AuthStub {
  const stub = (globalThis as { __AUTH_SERVICE_STUB__?: AuthStub }).__AUTH_SERVICE_STUB__;
  assert.ok(stub, "authService stub missing — use --require ./scripts/mock-auth-fetch-node.cjs");
  return stub;
}

async function run(): Promise<void> {
  const originalFetch = globalThis.fetch;
  const stub = getStub();

  try {
    // ── Successful POST ─────────────────────────────────────────────────────
    stub.__calls.getValidSession = 0;
    stub.__calls.refreshSessionSafely = 0;
    stub.getValidSession = async () => "tok-ok";
    stub.refreshSessionSafely = async () => ({ ok: true, token: "tok-retry" });

    const posts: Array<{ url: string; body: string | undefined; auth: string | null }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      posts.push({
        url,
        body: typeof init?.body === "string" ? init.body : undefined,
        auth: headers.get("Authorization"),
      });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const body = JSON.stringify({ steps: 42, raceId: "r1" });
    const resOk = await authFetch("/api/test/post", {
      method: "POST",
      body,
      timeoutMs: 5_000,
    });
    assert.equal(resOk.status, 200);
    assert.equal(posts.length, 1, "successful POST issues one fetch");
    assert.equal(posts[0].body, body);
    assert.equal(posts[0].auth, "Bearer tok-ok");
    assert.equal(stub.__calls.refreshSessionSafely, 0, "no refresh on success");

    // ── retryOnUnauthorized: false → no re-POST after 401 ───────────────────
    posts.length = 0;
    stub.__calls.getValidSession = 0;
    stub.__calls.refreshSessionSafely = 0;
    stub.getValidSession = async () => "tok-old";
    stub.refreshSessionSafely = async () => ({ ok: true, token: "tok-new" });

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      posts.push({
        url: String(input),
        body: typeof init?.body === "string" ? init.body : undefined,
        auth: headers.get("Authorization"),
      });
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const progressBody = JSON.stringify({ steps: 99, raceId: "race-x" });
    const res401 = await authFetch("/api/races/progress", {
      method: "POST",
      body: progressBody,
      retryOnUnauthorized: false,
      timeoutMs: 5_000,
    });
    assert.equal(res401.status, 401);
    assert.equal(posts.length, 1, "must not re-POST body after 401 when retryOnUnauthorized=false");
    assert.equal(posts[0].body, progressBody);
    assert.equal(posts[0].auth, "Bearer tok-old");
    assert.equal(
      stub.__calls.refreshSessionSafely,
      0,
      "skip 401 retry path does not call refreshSessionSafely",
    );

    // ── Default retryOnUnauthorized: true DOES refresh + retry once ─────────
    posts.length = 0;
    stub.__calls.refreshSessionSafely = 0;
    stub.getValidSession = async () => "tok-old";
    stub.refreshSessionSafely = async () => ({ ok: true, token: "tok-new" });

    let call = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      call += 1;
      const headers = new Headers(init?.headers);
      posts.push({
        url: String(_input),
        body: typeof init?.body === "string" ? init.body : undefined,
        auth: headers.get("Authorization"),
      });
      if (call === 1) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const retryBody = JSON.stringify({ ping: 1 });
    const resRetry = await authFetch("/api/test/retry", {
      method: "POST",
      body: retryBody,
      // default retryOnUnauthorized: true
      timeoutMs: 5_000,
    });
    assert.equal(resRetry.status, 200);
    assert.equal(posts.length, 2, "default policy retries once after refresh");
    assert.equal(posts[0].auth, "Bearer tok-old");
    assert.equal(posts[1].auth, "Bearer tok-new");
    assert.equal(posts[0].body, retryBody);
    assert.equal(posts[1].body, retryBody, "retry re-sends original body when enabled");
    assert.equal(stub.__calls.refreshSessionSafely, 1);

    console.log("authFetch.retryPolicy.test.ts — all assertions passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
