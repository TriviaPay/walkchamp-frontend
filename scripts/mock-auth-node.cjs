/**
 * Node preload for auth / authFetch unit tests.
 * Usage: npx tsx --require ./scripts/mock-auth-node.cjs <test-file>
 *
 * Mocks RN / Expo boundaries so authService + authFetch load under plain Node.
 * Also stubs authFetch when loading authService to break the circular import
 * (authService only needs timeoutSignal / API_TIMEOUT_MS at module init).
 */
"use strict";

if (!globalThis.expo) {
  class FakeEventEmitter {
    addListener() {
      return { remove() {} };
    }
    removeAllListeners() {}
    emit() {}
  }
  globalThis.expo = { EventEmitter: FakeEventEmitter };
}

const Module = require("module");
const store = new Map();

const secureStoreMock = {
  getItemAsync: async (key) => (store.has(key) ? store.get(key) : null),
  setItemAsync: async (key, value) => {
    store.set(key, String(value));
  },
  deleteItemAsync: async (key) => {
    store.delete(key);
  },
  __reset: () => store.clear(),
  __store: store,
};

const platform = { OS: "web", select: (spec) => spec.web ?? spec.default };
const rnMock = {
  Platform: platform,
  StyleSheet: { create: (s) => s },
  View: "View",
  Text: "Text",
  NativeModules: {},
};

/** Set true in authFetch tests so the real authFetch module can load. */
globalThis.__ALLOW_REAL_AUTH_FETCH__ = false;

const authFetchStub = {
  timeoutSignal(ms, callerSignal) {
    if (!callerSignal && typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  },
  API_TIMEOUT_MS: 12_000,
  STEP_SYNC_TIMEOUT: 6_000,
  CHAT_TIMEOUT: 8_000,
  PRESENCE_TIMEOUT: 5_000,
  authFetch: async () => {
    throw new Error("authFetch stub — enable __ALLOW_REAL_AUTH_FETCH__");
  },
};

function isAuthFetchRequest(request) {
  const norm = String(request).replace(/\\/g, "/");
  return (
    request === "@/utils/authFetch" ||
    norm.endsWith("/utils/authFetch") ||
    norm.endsWith("/utils/authFetch.ts") ||
    norm.endsWith("/utils/authFetch.js")
  );
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (
    request === "react-native" ||
    request.endsWith("/react-native") ||
    request === "react-native/Libraries/Utilities/PolyfillFunctions"
  ) {
    return rnMock;
  }
  if (
    request === "expo-secure-store" ||
    request.endsWith("expo-secure-store")
  ) {
    return secureStoreMock;
  }
  if (
    request === "expo-web-browser" ||
    request.endsWith("expo-web-browser")
  ) {
    return {
      openAuthSessionAsync: async () => ({ type: "dismiss" }),
      maybeCompleteAuthSession: () => {},
    };
  }
  if (
    request === "expo-apple-authentication" ||
    request.endsWith("expo-apple-authentication")
  ) {
    return {
      signInAsync: async () => {
        throw new Error("Apple sign-in not available in tests");
      },
      AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    };
  }
  if (
    request === "@react-native-async-storage/async-storage" ||
    request.endsWith("@react-native-async-storage/async-storage")
  ) {
    const asyncStore = new Map();
    const mock = {
      getItem: async (key) => (asyncStore.has(key) ? asyncStore.get(key) : null),
      setItem: async (key, value) => {
        asyncStore.set(key, String(value));
      },
      removeItem: async (key) => {
        asyncStore.delete(key);
      },
      clear: async () => asyncStore.clear(),
      getAllKeys: async () => Array.from(asyncStore.keys()),
      multiGet: async (keys) =>
        keys.map((k) => [k, asyncStore.has(k) ? asyncStore.get(k) : null]),
      multiSet: async (pairs) => {
        for (const [k, v] of pairs) asyncStore.set(k, String(v));
      },
      multiRemove: async (keys) => {
        for (const k of keys) asyncStore.delete(k);
      },
    };
    return { __esModule: true, default: mock, ...mock };
  }

  // Break authService ↔ authFetch cycle when testing refreshSessionSafely.
  if (!globalThis.__ALLOW_REAL_AUTH_FETCH__ && isAuthFetchRequest(request)) {
    return authFetchStub;
  }

  return originalLoad.apply(this, arguments);
};

globalThis.__SECURE_STORE_MOCK__ = secureStoreMock;
globalThis.__DEV__ = false;
globalThis.Platform = platform;
globalThis.__AUTH_FETCH_STUB__ = authFetchStub;
