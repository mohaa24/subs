"use client";

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import en from "@/messages/en.json";
import ta from "@/messages/ta.json";
import si from "@/messages/si.json";

type Locale = "en" | "ta" | "si";
type Messages = Record<string, any>;

const allMessages: Record<Locale, Messages> = { en, ta, si };

const I18nContext = createContext<{
  locale: Locale;
  t: (key: string) => string;
  setLocale: (l: Locale) => void;
}>({
  locale: "en",
  t: (key) => key,
  setLocale: () => {},
});

function resolve(obj: Messages, key: string): string | undefined {
  const parts = key.split(".");
  let cur: any = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return typeof cur === "string" ? cur : undefined;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("locale") : null;
    if (stored && (stored === "en" || stored === "ta" || stored === "si")) {
      setLocaleState(stored);
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof window !== "undefined") localStorage.setItem("locale", l);
  }, []);

  const t = useCallback(
    (key: string): string => {
      return resolve(allMessages[locale], key) ?? resolve(allMessages.en, key) ?? key;
    },
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation() {
  return useContext(I18nContext);
}
