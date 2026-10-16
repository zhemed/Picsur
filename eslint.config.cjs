/**
 * ESLint flat config (ESLint 9).
 *
 * Before this file existed the repo carried legacy `.eslintrc.cjs` files while
 * `eslint@9` was installed, so `pnpm lint` died on
 * "ESLint couldn't find an eslint.config.(js|mjs|cjs) file" — it never linted
 * anything. This is the migration of those four configs:
 *
 *   .eslintrc.cjs          -> `js.configs.recommended`
 *   backend/.eslintrc.cjs     + typescript-eslint `recommended`
 *   frontend/.eslintrc.cjs    + prettier via `eslint-plugin-prettier`
 *   shared/.eslintrc.cjs
 *
 * The legacy config disabled `@typescript-eslint/no-explicit-any` and
 * `@typescript-eslint/ban-ts-comment` on top of `recommended`; that is kept.
 * The per-package `parserOptions.project` / `ignorePatterns` had no effect on
 * any enabled rule (no type-aware rules were configured), so they were dropped
 * instead of setting up a project service for nothing.
 *
 * Scope: the TypeScript sources that ship (`frontend/src`, `backend/src`,
 * `shared/src`). Generated output and `*.exclude.*` helpers are ignored.
 * Test files, JSON/Markdown/HTML and CI YAML are **not** linted yet — see the
 * task report for that list.
 */

const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const prettierPlugin = require('eslint-plugin-prettier');
const prettierConfig = require('eslint-config-prettier');

/** Files we do not lint (generated, vendored, or not source at all). */
const GLOBAL_IGNORES = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.angular/**',
  '**/.worktrees/**',
  '**/*.exclude.*',
  'frontend/src/environments/**',
];

/**
 * Node globals for the CommonJS scripts (`support/*.cjs`, repo configs).
 *
 * `js.configs.recommended` turns on `no-undef` for every file it matches, and
 * these scripts run in Node — without this list `Buffer`, `__filename`,
 * `setTimeout`… would all be reported as undefined (that is what made CI red
 * for five runs in a row: `support/make-image-fixtures.cjs` alone had 13 such
 * errors).
 */
const NODE_GLOBALS = {
  module: 'writable',
  exports: 'writable',
  require: 'readonly',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  Buffer: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly',
};

/**
 * Browser globals for the `support/*-probe.cjs` scripts.
 *
 * They drive the resident Chromium through Playwright/CDP, so one file holds
 * both halves: the Node-side orchestration *and* the functions that are
 * injected into the page (`page.evaluate(...)` bodies are compiled in the
 * browser, yet eslint sees them in this file). Without browser globals every
 * `document` / `window` / `getComputedStyle` in those functions is a
 * false-positive `no-undef` error.
 *
 * These probes are **not** run in CI (they need a real browser, see
 * `.github/workflows/ci.yml`), but they are still linted: that is where the
 * syntax and dead-code problems get caught.
 */
const BROWSER_GLOBALS = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  localStorage: 'readonly',
  sessionStorage: 'readonly',
  getComputedStyle: 'readonly',
  requestAnimationFrame: 'readonly',
  Node: 'readonly',
  Element: 'readonly',
  HTMLElement: 'readonly',
  Event: 'readonly',
  MutationObserver: 'readonly',
};

module.exports = [
  { ignores: GLOBAL_IGNORES },

  js.configs.recommended,

  // TypeScript sources of every package in the workspace.
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...prettierConfig.rules,

      /**
       * Deferred: **the repo is not Prettier-clean yet.**
       *
       * `plugin:prettier/recommended` was part of the legacy config, but that
       * config never actually ran (see the note above), so the debt was never
       * surfaced: `prettier/prettier` currently reports ~255 problems in 59
       * files (e.g. `masonry.component.ts`, `docker-api.service.ts`). Turning
       * the rule on as an error would make this very first working `pnpm lint`
       * fail on files this task does not own.
       *
       * `pnpm format` exists and is the fix (`prettier --write .`), but that
       * reformat is a separate, reviewable change — re-enable this rule in the
       * same commit as that reformat.
       */
      'prettier/prettier': 'off',

      // The legacy config explicitly disabled these; keep that behaviour.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',

      // Rules from `js.configs.recommended` that TypeScript already covers.
      'no-unused-vars': 'off',
      'no-undef': 'off',

      // Unused code is caught by the compiler too; keep it visible without
      // failing the run.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  /**
   * Deferred findings — deliberately not fixed in this change (each one is
   * either a false positive or sits in a file another stream owns). The rule
   * stays `error` everywhere else, so these are the only exceptions:
   *
   *  - `no-useless-escape` on the two regex literals below: the escapes are
   *    redundant inside character classes but are kept on purpose for
   *    readability of those long URL/moment patterns.
   */
  {
    files: [
      'shared/src/util/common-regex.ts',
      'frontend/custom-webpack.config.cjs',
    ],
    rules: { 'no-useless-escape': 'off' },
  },

  // Repo-level CommonJS config files (this file, the webpack config, support/*.cjs).
  {
    files: ['**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...NODE_GLOBALS },
    },
  },

  // 浏览器探针：Node 编排 + 注入页面的代码混在同一个文件里，两套 globals 都要给（见上面注释）。
  {
    files: ['support/**/*-probe.cjs'],
    languageOptions: {
      globals: { ...NODE_GLOBALS, ...BROWSER_GLOBALS },
    },
  },
];
