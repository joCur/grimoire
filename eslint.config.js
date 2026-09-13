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
// is where those already come from in every migrated file.
//
// TWO SEVERITIES, on purpose (AK4):
//   error — the files Scheibe 1 migrated. They are done, and they stay done.
//   warn  — everything else in app/src. Scheibe 2 of #69 empties this list;
//           until then the warnings ARE the to-do list, visible on every run
//           without failing the build for work that is already planned.
//
// Run: `bun run lint` (repo root) — wired into CI next to the typecheck.

import js from "@eslint/js";
import react from "eslint-plugin-react";
import globals from "globals";
import tseslint from "typescript-eslint";

/** The files Scheibe 1 of issue #69 migrated — the strict half of the gate. */
const MIGRATED = [
  "app/src/main.tsx",
  "app/src/i18n/**/*.{ts,tsx}",
  "app/src/components/Topbar.tsx",
  "app/src/components/CreateDialog.tsx",
  "app/src/components/CreateActions.tsx",
  "app/src/components/LanguageSwitch.tsx",
  "app/src/components/PropertiesAction.tsx",
  "app/src/components/PropertiesFields.tsx",
  "app/src/components/RenameDialog.tsx",
  "app/src/routes/home.tsx",
];

/** The rule, with the one option that keeps it about COPY and not markup. */
const noLiterals = {
  "react/jsx-no-literals": [
    "error",
    {
      // Props are markup (className, data-testid, aria-hidden) — see header.
      ignoreProps: true,
      // Punctuation and separators are not copy in any language.
      allowedStrings: ["·", "—", "→", ":", "/", "|", "⌘K", "+", "×", "-"],
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
      "react/jsx-no-literals": ["warn", noLiterals["react/jsx-no-literals"][1]],
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-empty": "off",
      "no-control-regex": "off",
    },
  },
  // The migrated files: the same rule, sharp.
  {
    files: MIGRATED,
    rules: noLiterals,
  },
);
