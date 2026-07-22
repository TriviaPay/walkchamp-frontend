/**
 * Node preload for unit tests that import @/utils/storage.
 * Usage: npx tsx --require ./scripts/mock-async-storage.cjs <test-file>
 */
"use strict";

const Module = require("module");
const store = new Map();

const mock = {
  getItem: async (key) => (store.has(key) ? store.get(key) : null),
  setItem: async (key, value) => {
    store.set(key, String(value));
  },
  removeItem: async (key) => {
    store.delete(key);
  },
  clear: async () => {
    store.clear();
  },
  getAllKeys: async () => Array.from(store.keys()),
  multiGet: async (keys) => keys.map((k) => [k, store.has(k) ? store.get(k) : null]),
  multiSet: async (pairs) => {
    for (const [k, v] of pairs) store.set(k, String(v));
  },
  multiRemove: async (keys) => {
    for (const k of keys) store.delete(k);
  },
  __reset: () => store.clear(),
  __store: store,
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (
    request === "@react-native-async-storage/async-storage" ||
    request.endsWith("@react-native-async-storage/async-storage")
  ) {
    return { __esModule: true, default: mock, ...mock };
  }
  return originalLoad.apply(this, arguments);
};

globalThis.__ASYNC_STORAGE_MOCK__ = mock;
