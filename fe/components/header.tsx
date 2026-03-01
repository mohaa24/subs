"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n";
import { Building2, LogOut, Shield, Globe } from "lucide-react";
import { api } from "@/lib/api";

const ROLE_LABELS: Record<string, string> = {
  super_user: "Super User",
  admin: "Admin",
  user: "User",
};

const LOCALE_OPTIONS: { value: "en" | "ta" | "si"; label: string; code: string }[] = [
  { value: "en", label: "English", code: "EN" },
  { value: "ta", label: "Tamil", code: "TA" },
  { value: "si", label: "Sinhala", code: "SI" },
];

export function Header() {
  const { user, logout, refetch } = useAuth();
  const { locale, t, setLocale: setI18nLocale } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  const currentLocaleOption = LOCALE_OPTIONS.find((o) => o.value === locale) || LOCALE_OPTIONS[0];

  const setLocale = async (value: "en" | "ta" | "si") => {
    setI18nLocale(value);
    setLangOpen(false);
    try {
      await api("/users/me", {
        method: "PATCH",
        body: JSON.stringify({ locale: value }),
      });
      await refetch();
    } catch {}
  };

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    if (menuOpen || langOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, langOpen]);

  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";
  const orgName = user?.organization?.name;

  return (
    <header className="border-b border-border/60 bg-card/80 backdrop-blur-sm px-5 py-3 flex items-center justify-between sticky top-0 z-50">
      {/* Left: org name */}
      <div className="flex items-center gap-2">
        <div className="h-6 w-6 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
          <Building2 className="h-3.5 w-3.5 text-primary" />
        </div>
        {orgName ? (
          <span className="text-sm font-semibold text-foreground leading-none">
            {orgName}
          </span>
        ) : (
          <span className="text-sm font-semibold text-foreground leading-none">
            Membership
          </span>
        )}
      </div>

      {/* Right: language switcher + avatar */}
      <div className="flex items-center gap-2">
        <div className="relative" ref={langRef}>
          <button
            onClick={() => setLangOpen((v) => !v)}
            aria-label="Change language"
            className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg border border-border/60 bg-card/50 hover:bg-accent/50 transition-colors text-sm font-medium"
          >
            <Globe className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{currentLocaleOption.code}</span>
          </button>
          {langOpen && (
            <div className="absolute right-0 mt-2 w-44 rounded-xl border border-border/80 bg-popover shadow-2xl shadow-black/50 overflow-hidden z-50 py-1">
              {LOCALE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLocale(opt.value)}
                  className={`w-full text-left px-4 py-2 text-sm hover:bg-accent transition-colors ${
                    opt.value === locale ? "text-primary font-medium" : "text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Open user menu"
            className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary hover:bg-primary/20 hover:border-primary/40 transition-all focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            {initials}
          </button>

          {menuOpen && (
            <div className="absolute right-0 mt-2 w-60 rounded-xl border border-border/80 bg-popover shadow-2xl shadow-black/50 overflow-hidden z-50">
            <div className="px-4 py-3 border-b border-border/60 bg-card/50">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                  {initials}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">
                    {user?.email}
                  </p>
                  <div className="flex items-center gap-1 mt-0.5">
                    <Shield className="h-3 w-3 text-primary" />
                    <p className="text-xs text-muted-foreground">
                      {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="p-1.5">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  logout();
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg hover:bg-accent text-foreground transition-colors group"
              >
                <LogOut className="h-4 w-4 text-muted-foreground group-hover:text-destructive transition-colors" />
                <span>{t("auth.logout")}</span>
              </button>
            </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
