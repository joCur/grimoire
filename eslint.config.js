// The i18n lint gate (issue #69 AK4).
//
// This config has ONE job: keep user-visible copy out of the components and in
// the catalog (app/src/i18n). It is deliberately not a general-purpose lint
// stack — style is settled by the reviewers and by TypeScript, and a rule set
// nobody asked for would only add noise to a gate that has to stay credible.
//
// The rule is `react/jsx-no-literals`: a literal TEXT CHILD inside JSX.
//
//   <span>Session starten</span>          ✗
//   <span>{t("session.start")}</span>     ✓
//
// Props are NOT checked (`ignoreProps`): every `className`, `data-*` and
// `aria-hidden` is a literal by nature, and a rule that flags those would be
// switched off within a day. Copy that travels through a prop (`aria-label`,
// `placeholder`, a dialog `title`) is caught by review instead — the catalog
// is where those already come from in every file now.
//
// ONE SEVERITY, everywhere: `error`. The two-tier version of this config
// (error for the files Scheibe 1 had migrated, warn for the rest as a visible
// to-do list) served exactly as long as there was a rest. The migration is
// complete since the PO dropped the slicing on PR #83 — 165 warnings went to
// zero — so a `warn` tier now has nothing to hold but the next regression.
//
// Run: `bun run lint` (repo root) — wired into CI next to the typecheck.

import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * Strings that are NOT copy in any language and therefore not the catalog's
 * business. Three kinds, and nothing else gets in here:
 *
 *   * SEPARATORS and punctuation that carry a sentence rather than being one
 *     (`·`, `—`, `›`, `#`, the parentheses around a count).
 *   * KEY HINTS — the names of physical keys (`⌘K`, `esc`) are the same on a
 *     German and an English keyboard.
 *   * MARKUP BEING SHOWN: the block composer previews raw markdown, so `[!`
 *     and `]` around a callout marker are the FORMAT quoted on screen, not a
 *     label (README, "Callouts").
 *
 * An entry here is a claim that the string reads identically in every
 * language. When in doubt it belongs in the catalog.
 */
const NOT_COPY = [
  "·",
  "—",
  "→",
  "›",
  ":",
  "/",
  "|",
  "+",
  "×",
  "-",
  "#",
  "(",
  ")",
  "⌘K",
  "esc",
  "[!",
  "]",
];

/** The rule, with the one option that keeps it about COPY and not markup. */
const noLiterals = {
  "react/jsx-no-literals": [
    "error",
    {
      // Props are markup (className, data-testid, aria-hidden) — see header.
      ignoreProps: true,
      allowedStrings: NOT_COPY,
    },
  ],
};

export default tseslint.config(
  {
    // Never lint build output, dependencies, or the E2E report.
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "e2e/playwright-report/**",
      "e2e/test-results/**",
      "**/*.d.ts",
    ],
  },
  // Only the frontend has JSX, so only the frontend is in scope at all.
  {
    files: ["app/src/**/*.{ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser },
    },
    plugins: { react },
    settings: { react: { version: "detect" } },
    // Everything js.configs.recommended brings that TypeScript already owns —
    // this config is the i18n gate, not a second type checker.
    rules: {
      ...noLiterals,
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-control-regex": "off",
    },
  },
);
