import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Expo / React Native lint — correctness-focused, not a full stylistic rewrite.
 * Marketing Vite tree (`src/`) is ignored; use tsconfig.marketing.json separately.
 */
export default defineConfig([
  globalIgnores([
    "dist/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "android/**",
    "ios/**",
    ".expo/**",
    "src/**",
    "vite.config.ts",
    "scripts/**",
    "**/*.test.ts",
    "index.js",
    "babel.config.js",
    "metro.config.js",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      "react-hooks": reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        ...globals.node,
        __DEV__: "readonly",
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "no-console": "off",
      "prefer-const": "warn",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
]);
