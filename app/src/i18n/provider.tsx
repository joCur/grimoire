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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { fetchSettings, putSettings } from "@/api";

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
  /** True while the instance setting has not been read yet. */
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

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
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
