/**
 * Node preload for authFetch retry-policy tests.
 * Stubs authService (breaks circular import) and RN/Expo boundaries.
 * Usage: npx tsx --require ./scripts/mock-auth-fetch-node.cjs utils/authFetch.retryPolicy.test.ts
 */
"use strict";

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

/** Controllable authService doubles — mutate from the test file. */
const authServiceStub = {
  getValidSession: async () => "session-token-v1",
  refreshSessionSafely: async () => ({ ok: true, token: "session-token-v2" }),
  __calls: { getValidSession: 0, refreshSessionSafely: 0 },
};

function wrapAuthService() {
  return {
    getValidSession: async (...args) => {
      authServiceStub.__calls.getValidSession += 1;
      return authServiceStub.getValidSession(...args);
    },
    refreshSessionSafely: async (...args) => {
      authServiceStub.__calls.refreshSessionSafely += 1;
      return authServiceStub.refreshSessionSafely(...args);
    },
  };
}

function isAuthServiceRequest(request) {
  const norm = String(request).replace(/\\/g, "/");
  return (
    request === "@/services/authService" ||
    norm.endsWith("/services/authService") ||
    norm.endsWith("/services/authService.ts") ||
    norm.endsWith("/services/authService.js")
  );
}

function isSessionHeadersRequest(request) {
  const norm = String(request).replace(/\\/g, "/");
  return (
    request === "@/services/sessionRequestHeaders" ||
    norm.endsWith("/services/sessionRequestHeaders") ||
    norm.endsWith("/services/sessionRequestHeaders.ts")
  );
}

function isSessionInvalidationRequest(request) {
  const norm = String(request).replace(/\\/g, "/");
  return (
    request === "@/services/sessionInvalidation" ||
    norm.endsWith("/services/sessionInvalidation") ||
    norm.endsWith("/services/sessionInvalidation.ts")
  );
}

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (
    request === "react-native" ||
    request.endsWith("/react-native")
  ) {
    return rnMock;
  }
  if (request === "expo-secure-store" || request.endsWith("expo-secure-store")) {
    return secureStoreMock;
  }
  if (request === "expo-web-browser" || request.endsWith("expo-web-browser")) {
    return { openAuthSessionAsync: async () => ({ type: "dismiss" }), maybeCompleteAuthSession: () => {} };
  }
  if (request === "expo-apple-authentication" || request.endsWith("expo-apple-authentication")) {
    return {
      signInAsync: async () => {
        throw new Error("unavailable");
      },
      AppleAuthenticationScope: {},
    };
  }
  if (isAuthServiceRequest(request)) {
    return wrapAuthService();
  }
  if (isSessionHeadersRequest(request)) {
    return {
      buildSessionRequestHeaders: async () => ({}),
    };
  }
  if (isSessionInvalidationRequest(request)) {
    return {
      handleSessionInvalidation: async () => {},
      parseSessionErrorFromResponse: async () => null,
    };
  }
  return originalLoad.apply(this, arguments);
};

globalThis.__AUTH_SERVICE_STUB__ = authServiceStub;
globalThis.__SECURE_STORE_MOCK__ = secureStoreMock;
globalThis.__DEV__ = false;
process.env.EXPO_PUBLIC_API_URL = process.env.EXPO_PUBLIC_API_URL || "http://authfetch.test";
