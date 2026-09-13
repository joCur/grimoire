// The React half of i18n (issue #69): one context above the whole app, so
// every `t()` in the tree speaks the same language and a switch re-renders
// everything at once — no reload, no page flash.
//
// WHERE THE LANGUAGE COMES FROM, in order:
//   1. the INSTANCE setting on the server (GET /api/settings) — the truth,
//   2. `navigator.language` while that setting is `null` ("never decided"),
//   3. German, when there is no navigator at all (tests, SSR).
//
// Nothing is written for case 2: only an explicit switch stores a value. The
// switch is a react-query mutation that invalidates `["settings"]`, which is
// what makes the new language appear immediately (AK2) and survive a reload
// (it came from the server in the first place).
//
// THE FIRST PAINT IS GATED. `GET /api/settings` is one local round trip, but
// rendering the browser's language while it is in flight means an instance set
// to German shows an English chrome for a frame and then swaps it — the tool
// looks broken at the one moment there is nothing else to look at. So while
// the query is pending NOTHING language-dependent is rendered at all: the
// children stay unmounted behind a neutral shell (the wordmark glyph, which is
// a logo and not copy), and the tree mounts once with the language it keeps.
// Consequence: `isPending` is always false for anything BELOW this provider —
// no component has to handle a "language not known yet" state.
//
// `<html lang>` follows the language from here too (`index.html` can only
// carry a static value): a wrong `lang` mis-pronounces the whole page in a
// screen reader and mis-hyphenates it in the browser.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

import { fetchSettings, putSettings } from "@/api";
import { IconLogo } from "@/icons";

import { formatDate, formatParts, translator, type MessageParams, type Translate } from "./format";
import { browserLocale, DEFAULT_LOCALE, type Locale, type MessageKey } from "./messages";

export interface I18n {
  /** The language every message in this render is formatted in. */
  locale: Locale;
  /** `t(key, params)` — ICU MessageFormat, see ./format.ts. */
  t: Translate;
  /** A message whose parameters may be react nodes (markup inside a sentence). */
  tNode: (key: MessageKey, params?: MessageParams) => ReactNode;
  /** A date in the current language, via `Intl` (AK3). */
  date: (value: Date) => string;
  /** True while the instance setting has not been read yet. Always false
   * below `I18nProvider`, which gates its children on exactly that. */
  isPending: boolean;
  /** Store a language for the instance (server-side, effective at once). */
  setLocale: (locale: Locale) => void;
  /** True while a switch is in flight. */
  isSwitching: boolean;
}

const I18nContext = createContext<I18n | undefined>(undefined);

/** The settings query key — the same one the switch invalidates. */
export const SETTINGS_KEY = ["settings"] as const;

export function I18nProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: fetchSettings });

  const switchLocale = useMutation({
    mutationFn: (locale: Locale) => putSettings({ locale }),
    onSuccess: (next) => {
      queryClient.setQueryData(SETTINGS_KEY, next);
      void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
  });

  const { mutate } = switchLocale;

  // A failed settings query must not take the language with it: the browser's
  // own preference is a perfectly good answer, and a server that cannot be
  // reached has bigger problems to report than its language.
  const locale: Locale = settings.data?.locale ?? browserLocale();

  // `<html lang>`: the document's language, kept in sync with the UI's. Only
  // once the setting is known — during the gate below there is no answer yet,
  // and `index.html` already carries the default.
  useEffect(() => {
    if (settings.isPending) return;
    document.documentElement.lang = locale;
  }, [locale, settings.isPending]);

  const value = useMemo<I18n>(() => {
    const t = translator(locale);
    return {
      locale,
      t,
      tNode: (key, params) => formatParts(locale, key, params) as ReactNode,
      date: (when) => formatDate(locale, when),
      isPending: settings.isPending,
      setLocale: (next) => mutate(next),
      isSwitching: switchLocale.isPending,
    };
  }, [locale, settings.isPending, switchLocale.isPending, mutate]);

  // The gate (see header): no copy before the language is settled.
  if (settings.isPending) return <LanguageShell />;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * What is on screen for the one round trip the settings query takes: the
 * wordmark glyph on the app background, centred. No text — a "Lade …" here
 * would be the very flash this shell exists to prevent — and no spinner, which
 * would have to animate for a few dozen milliseconds (and `prefers-reduced-
 * motion` says it should not, quality floor). `aria-busy` says what it is.
 */
function LanguageShell() {
  return (
    <div
      aria-busy="true"
      className="flex h-dvh items-center justify-center bg-background text-faint"
    >
      <IconLogo size={28} />
    </div>
  );
}

/**
 * The whole i18n handle. Outside a provider (unit tests that render one
 * component) it degrades to the default language with no server round trip —
 * never to a crash.
 */
export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (context !== undefined) return context;
  const t = translator(DEFAULT_LOCALE);
  return {
    locale: DEFAULT_LOCALE,
    t,
    tNode: (key, params) => formatParts(DEFAULT_LOCALE, key, params) as ReactNode,
    date: (value) => formatDate(DEFAULT_LOCALE, value),
    isPending: false,
    setLocale: () => undefined,
    isSwitching: false,
  };
}

/** The common case: just the translator. */
export function useT(): Translate {
  return useI18n().t;
}
