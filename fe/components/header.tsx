"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import { useAuth } from "@/lib/auth-context";
import { useTranslation } from "@/lib/i18n";
import { api } from "@/lib/api";
import type { UserBookmark, UserRole } from "@/lib/api";
import { quickActionByKey } from "@/lib/quick-actions";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Building2,
  ChevronDown,
  ClipboardList,
  Globe,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  PieChart,
  QrCode,
  ReceiptText,
  Search,
  Settings,
  Star,
  Shield,
  Users,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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

type NavChild = {
  label: string;
  href?: string;
  actionKey?: string;
  badge?: string;
  disabled?: boolean;
  roles?: UserRole[];
};

type NavItem = {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  actionKey?: string;
  badge?: string;
  disabled?: boolean;
  children?: NavChild[];
};

type SearchItem = {
  label: string;
  description: string;
  href?: string;
  disabled?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/", actionKey: "nav-dashboard" },
  {
    key: "members",
    label: "Members",
    icon: Users,
    children: [
      { label: "Manage Members", href: "/members", actionKey: "nav-manage-members" },
      { label: "People Profile", href: "/persons", actionKey: "nav-people-profile" },
      { label: "Member Transactions", href: "/payments/history", actionKey: "nav-member-transactions" },
    ],
  },
  {
    key: "cash-in",
    label: "Cash In",
    icon: ArrowDownToLine,
    children: [
      { label: "Member Payments", href: "/payments", actionKey: "nav-member-payments" },
      { label: "Income Accounts", href: "/cash-in", actionKey: "nav-income-accounts" },
    ],
  },
  {
    key: "cash-out",
    label: "Cash Out",
    icon: ArrowUpFromLine,
    children: [
      { label: "Expense Accounts", href: "/cash-out", actionKey: "nav-expense-accounts" },
    ],
  },
  { key: "banking", label: "Banking", icon: Landmark, href: "/banking", actionKey: "nav-banking" },
  { key: "funds", label: "Special Funds", icon: Landmark, href: "/funds", actionKey: "nav-special-funds" },
  { key: "receivable", label: "Receivable", icon: ReceiptText, href: "/receivables", actionKey: "nav-receivable" },
  { key: "payable", label: "Payable", icon: ClipboardList, href: "/payables", actionKey: "nav-payable" },
  {
    key: "accounts",
    label: "Chart of Accounts",
    icon: WalletCards,
    children: [
      { label: "Chart of Accounts", href: "/accounting", actionKey: "nav-chart-of-accounts" },
      { label: "Journals", href: "/journals", actionKey: "nav-account-journals" },
    ],
  },
  {
    key: "reports",
    label: "Reports",
    icon: BarChart3,
    children: [
      { label: "Member Reports", href: "/member-reports", actionKey: "nav-member-reports" },
      { label: "Financial Reports", href: "/finance-reports", actionKey: "nav-finance-reports" },
    ],
  },
  {
    key: "announcements",
    label: "Announcements",
    icon: MessageSquare,
    children: [
      { label: "Announcements", href: "/announcements", actionKey: "nav-announcements" },
      { label: "Templates", href: "/announcements/templates" },
      { label: "Groups", href: "/announcements/groups" },
    ],
  },
  { key: "payroll", label: "Payroll", icon: Users, badge: "Coming Soon", disabled: true },
  { key: "budgets", label: "Budgets", icon: PieChart, badge: "Coming Soon", disabled: true },
  { key: "scan", label: "Scan QR Code", icon: QrCode, href: "/?scan=membership" },
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    children: [
      { label: "Administration", href: "/organizations", actionKey: "nav-administration" },
      { label: "Financial Setup", href: "/settings/financial-setup", roles: ["super_user"] },
      { label: "User & Roles", href: "/users", actionKey: "nav-user-roles" },
      { label: "Form Settings", href: "/settings/form-config", actionKey: "nav-form-settings" },
      { label: "Zones", href: "/settings/zones", actionKey: "nav-zones" },
      { label: "Due Types", href: "/settings/due-types", actionKey: "nav-due-types" },
      { label: "SMS Settings", href: "/settings/messages", actionKey: "nav-sms-settings" },
      { label: "Audit Log", href: "/audit-log" },
    ],
  },
];

function searchItemsForRole(role?: UserRole): SearchItem[] {
  return NAV_ITEMS.flatMap((item) => {
  const firstChildHref = item.children?.find((child) => !child.disabled && child.href)?.href;
  const groupItem: SearchItem[] = item.href || firstChildHref || item.disabled
    ? [
        {
          label: item.label,
          description: item.disabled ? "Coming soon" : "Open section",
          href: item.href ?? firstChildHref,
          disabled: item.disabled,
        },
      ]
    : [{ label: item.label, description: "Navigation group", disabled: true }];
  const children = item.children?.filter((child) => !child.roles || (role && child.roles.includes(role))).map((child) => ({
    label: child.label,
    description: `${item.label}${child.disabled ? " - Coming soon" : ""}`,
    href: child.href,
    disabled: child.disabled,
  })) ?? [];
  return [...groupItem, ...children];
  });
}

function isActivePath(pathname: string, href?: string) {
  if (!href) return false;
  const cleanHref = href.split("?")[0];
  if (cleanHref === "/") return pathname === "/";
  if (cleanHref === "/announcements") return pathname === cleanHref;
  return pathname === cleanHref || pathname.startsWith(`${cleanHref}/`);
}

function itemIsActive(pathname: string, item: NavItem) {
  return isActivePath(pathname, item.href) || !!item.children?.some((child) => isActivePath(pathname, child.href));
}

function MenuPanel({
  onNavigate,
  bookmarks,
  onToggleBookmark,
  role,
}: {
  onNavigate?: () => void;
  bookmarks: UserBookmark[];
  onToggleBookmark: (actionKey: string) => void;
  role?: UserRole;
}) {
  const pathname = usePathname();
  const initialOpen = useMemo(() => {
    const entries = NAV_ITEMS.filter((item) => item.children?.length).map((item) => [item.key, itemIsActive(pathname, item)]);
    return Object.fromEntries(entries) as Record<string, boolean>;
  }, [pathname]);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);
  const bookmarkLimitReached = bookmarks.length >= 6;

  const bookmarkButton = (actionKey?: string) => {
    if (!actionKey || !quickActionByKey(actionKey)) return null;
    const saved = bookmarks.some((bookmark) => bookmark.actionKey === actionKey);
    const disabled = !saved && bookmarkLimitReached;
    return (
      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!disabled) onToggleBookmark(actionKey);
        }}
        disabled={disabled}
        title={disabled ? "You can bookmark up to six quick actions" : saved ? "Remove from quick actions" : "Add to quick actions"}
        aria-label={saved ? "Remove from quick actions" : "Add to quick actions"}
        className={`ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity ${
          disabled ? "cursor-not-allowed text-blue-100/30" : "opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white/15"
        }`}
      >
        <Star className={`h-3.5 w-3.5 ${saved ? "fill-amber-300 text-amber-300 opacity-100" : "text-blue-100"}`} />
      </button>
    );
  };

  useEffect(() => {
    setOpenGroups((current) => ({ ...initialOpen, ...current }));
  }, [initialOpen]);

  return (
    <div className="flex h-full flex-col bg-[#061f43] text-white shadow-2xl shadow-slate-950/30">
      <div className="px-6 pb-5 pt-7">
        <Link href="/" onClick={onNavigate} className="block">
          <div className="text-2xl font-bold tracking-wide">CIVICA</div>
          <div className="mt-1 text-sm text-blue-100/90">Finance Suite</div>
        </Link>
      </div>

      <nav className="civica-sidebar-scroll min-h-0 flex-1 space-y-1 overflow-y-auto px-4 pb-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = itemIsActive(pathname, item);
          const open = openGroups[item.key] ?? false;
          const baseClass = `group flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
            active
              ? item.children?.length
                ? "text-white hover:bg-white/10"
                : "bg-white/10 text-white"
              : "text-blue-50/90 hover:bg-white/10 hover:text-white"
          }`;

          return (
            <div key={item.key} className="border-b border-white/10 pb-1.5">
              {item.children?.length ? (
                <>
                  <button
                    type="button"
                    className={baseClass}
                    onClick={() => setOpenGroups((current) => ({ ...current, [item.key]: !open }))}
                    aria-expanded={open}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
                  </button>
                  {open ? (
                    <div className="ml-7 mt-1 space-y-0.5 pb-1">
                      {item.children.filter((child) => !child.roles || (role && child.roles.includes(role))).map((child) => {
                        const childActive = isActivePath(pathname, child.href);
                        const childClass = `group flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-3 py-2 text-xs transition-colors ${
                          child.disabled
                            ? "cursor-not-allowed text-blue-100/40"
                            : childActive
                              ? "bg-white/10 text-white"
                              : "text-blue-100/75 hover:bg-white/10 hover:text-white"
                        }`;
                        const childContent = (
                          <>
                            <span className="truncate">{child.label}</span>
                            {child.badge ? <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-blue-50">{child.badge}</span> : null}
                          </>
                        );
                        if (child.disabled || !child.href) {
                          return (
                            <div key={`${item.key}-${child.label}`} className={childClass} aria-disabled="true">
                              {childContent}
                            </div>
                          );
                        }
                        return (
                          <div key={`${item.key}-${child.label}`} className="group flex items-center gap-1">
                            <Link href={child.href} onClick={onNavigate} className={childClass}>{childContent}</Link>
                            {bookmarkButton(child.actionKey)}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : (
                item.disabled || !item.href ? (
                  <div className={`${baseClass} cursor-not-allowed text-blue-50/65 hover:bg-transparent`} aria-disabled="true">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge ? <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-blue-50">{item.badge}</span> : null}
                  </div>
                ) : (
                  <div className="group flex items-center gap-1">
                    <Link href={item.href} onClick={onNavigate} className={baseClass}>
                      <Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.badge ? <span className="rounded bg-white/10 px-2 py-0.5 text-[10px] text-blue-50">{item.badge}</span> : null}
                    </Link>
                    {bookmarkButton(item.actionKey)}
                  </div>
                )
              )}
            </div>
          );
        })}
      </nav>

    </div>
  );
}

export function Header() {
  const { user, logout, refetch, organizations, activeOrganization, switchOrganization } = useAuth();
  const { locale, t, setLocale: setI18nLocale } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<UserBookmark[]>([]);
  const desktopUserMenuRef = useRef<HTMLDivElement>(null);
  const mobileUserMenuRef = useRef<HTMLDivElement>(null);
  const desktopLangRef = useRef<HTMLDivElement>(null);
  const mobileLangRef = useRef<HTMLDivElement>(null);

  const currentLocaleOption = LOCALE_OPTIONS.find((o) => o.value === locale) || LOCALE_OPTIONS[0];
  const initials = user?.email ? user.email.slice(0, 2).toUpperCase() : "??";
  const orgName = user?.organization?.name;

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

  const fetchBookmarks = async () => {
    try {
      setBookmarks(await api<UserBookmark[]>("/bookmarks"));
    } catch {
      /* quick actions are non-critical */
    }
  };

  const toggleBookmark = async (actionKey: string) => {
    const saved = bookmarks.some((bookmark) => bookmark.actionKey === actionKey);
    try {
      if (saved) {
        await api(`/bookmarks/${encodeURIComponent(actionKey)}`, { method: "DELETE" });
      } else {
        await api("/bookmarks", { method: "POST", body: JSON.stringify({ actionKey }) });
      }
      await fetchBookmarks();
      window.dispatchEvent(new Event("civica-bookmarks-updated"));
    } catch {
      await fetchBookmarks();
    }
  };

  useEffect(() => {
    if (user) void fetchBookmarks();
  }, [user]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const clickedUserMenu =
        desktopUserMenuRef.current?.contains(target) || mobileUserMenuRef.current?.contains(target);
      const clickedLangMenu =
        desktopLangRef.current?.contains(target) || mobileLangRef.current?.contains(target);

      if (!clickedUserMenu) {
        setUserMenuOpen(false);
      }
      if (!clickedLangMenu) {
        setLangOpen(false);
      }
    }
    if (userMenuOpen || langOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [userMenuOpen, langOpen]);

  return (
    <>
      <aside className="civica-sidebar fixed inset-y-0 left-0 z-50 hidden w-[17rem] lg:block">
        <MenuPanel bookmarks={bookmarks} onToggleBookmark={toggleBookmark} role={user?.role} />
      </aside>

      <header className="civica-toolbar sticky top-0 z-40 hidden h-[4.5rem] items-center justify-between border-b border-border/60 bg-background/95 px-6 backdrop-blur-sm lg:flex">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Building2 className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{orgName || "Membership"}</p>
            <p className="text-xs text-muted-foreground">Workspace</p>
          </div>
          {user?.role === "super_user" && (
            <select
              aria-label="Switch organization"
              value={activeOrganization?.id ?? ""}
              onChange={(event) => switchOrganization(event.target.value)}
              className="ml-2 h-9 max-w-[260px] rounded-md border border-border/70 bg-card px-3 text-sm font-medium shadow-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
            >
              <option value="" disabled>Select organization</option>
              {organizations.filter((organization) => organization.isActive !== false).map((organization) => (
                <option key={organization.id} value={organization.id}>{organization.name}</option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          <NavigationSearch role={user?.role} />
          <LanguageMenu
            langRef={desktopLangRef}
            langOpen={langOpen}
            setLangOpen={setLangOpen}
            currentLocaleOption={currentLocaleOption}
            setLocale={setLocale}
          />
          <UserMenu
            initials={initials}
            user={user}
            userMenuRef={desktopUserMenuRef}
            open={userMenuOpen}
            setOpen={setUserMenuOpen}
            logout={logout}
            t={t}
          />
        </div>
      </header>

      <header className="sticky top-0 z-50 flex items-center justify-between border-b border-border/60 bg-card/90 px-4 py-3 backdrop-blur-sm lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border/70 bg-background"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        {user?.role === "super_user" ? (
          <select
            aria-label="Switch organization"
            value={activeOrganization?.id ?? ""}
            onChange={(event) => switchOrganization(event.target.value)}
            className="mx-2 h-9 min-w-0 max-w-[190px] flex-1 rounded-md border border-border/70 bg-background px-2 text-xs font-medium"
          >
            <option value="" disabled>Select organization</option>
            {organizations.filter((organization) => organization.isActive !== false).map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
        ) : (
          <Link href="/" className="text-center">
            <div className="text-sm font-bold tracking-wide text-foreground">CIVICA</div>
            <div className="text-[11px] text-muted-foreground">Finance Suite</div>
          </Link>
        )}
        <div className="flex items-center gap-2">
          <LanguageMenu
            langRef={mobileLangRef}
            langOpen={langOpen}
            setLangOpen={setLangOpen}
            currentLocaleOption={currentLocaleOption}
            setLocale={setLocale}
          />
          <UserMenu
            initials={initials}
            user={user}
            userMenuRef={mobileUserMenuRef}
            open={userMenuOpen}
            setOpen={setUserMenuOpen}
            logout={logout}
            t={t}
          />
        </div>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/45"
            onClick={() => setMenuOpen(false)}
          />
          <div className="relative h-full w-[18rem] max-w-[85vw]">
            <button
              type="button"
              onClick={() => setMenuOpen(false)}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white"
              aria-label="Close navigation"
            >
              <X className="h-4 w-4" />
            </button>
            <MenuPanel onNavigate={() => setMenuOpen(false)} bookmarks={bookmarks} onToggleBookmark={toggleBookmark} role={user?.role} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function NavigationSearch({ role }: { role?: UserRole }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const trimmedQuery = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!trimmedQuery) return [];
    return searchItemsForRole(role).filter((item) => {
      const haystack = `${item.label} ${item.description}`.toLowerCase();
      return haystack.includes(trimmedQuery);
    }).slice(0, 5);
  }, [role, trimmedQuery]);
  const showPanel = focused && trimmedQuery.length > 0;

  return (
    <div className="relative w-[320px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        placeholder="Search anything..."
        className="h-11 w-full rounded-md border border-border/70 bg-card pl-10 pr-3 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
      />
      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-md border border-border/80 bg-popover shadow-xl shadow-black/10">
          {results.length ? (
            <div className="py-1.5">
              {results.map((item) => {
                const content = (
                  <>
                    <span className="truncate text-sm font-medium text-foreground">{item.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{item.description}</span>
                  </>
                );

                if (item.disabled || !item.href) {
                  return (
                    <div
                      key={`${item.label}-${item.description}`}
                      className="flex cursor-not-allowed flex-col gap-0.5 px-3 py-2 opacity-60"
                      aria-disabled="true"
                    >
                      {content}
                    </div>
                  );
                }

                return (
                  <Link
                    key={`${item.label}-${item.description}`}
                    href={item.href}
                    onClick={() => {
                      setQuery("");
                      setFocused(false);
                    }}
                    className="flex flex-col gap-0.5 px-3 py-2 transition-colors hover:bg-accent"
                  >
                    {content}
                  </Link>
                );
              })}
            </div>
          ) : (
            <div className="px-3 py-3 text-sm text-muted-foreground">No navigation results</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function LanguageMenu({
  compact,
  langRef,
  langOpen,
  setLangOpen,
  currentLocaleOption,
  setLocale,
}: {
  compact?: boolean;
  langRef: RefObject<HTMLDivElement>;
  langOpen: boolean;
  setLangOpen: (open: boolean | ((value: boolean) => boolean)) => void;
  currentLocaleOption: { value: "en" | "ta" | "si"; label: string; code: string };
  setLocale: (value: "en" | "ta" | "si") => void;
}) {
  return (
    <div className="relative" ref={langRef}>
      <button
        onClick={() => setLangOpen((v) => !v)}
        aria-label="Change language"
        className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium transition-colors ${
          compact ? "border-white/15 bg-white/8 text-white hover:bg-white/12" : "border-border/60 bg-card/50 hover:bg-accent/50"
        }`}
      >
        <Globe className={`h-3.5 w-3.5 ${compact ? "text-blue-100" : "text-muted-foreground"}`} />
        <span>{currentLocaleOption.code}</span>
      </button>
      {langOpen && (
        <div className={`absolute right-0 z-50 mt-2 w-44 overflow-hidden rounded-md border py-1 shadow-2xl ${
          compact ? "border-white/15 bg-[#0a2a56] text-white shadow-slate-950/40" : "border-border/80 bg-popover shadow-black/20"
        }`}>
          {LOCALE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setLocale(opt.value)}
              className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                compact ? "hover:bg-white/10" : "hover:bg-accent"
              } ${opt.value === currentLocaleOption.value ? "font-semibold" : ""}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserMenu({
  dark,
  initials,
  user,
  userMenuRef,
  open,
  setOpen,
  logout,
  t,
}: {
  dark?: boolean;
  initials: string;
  user: ReturnType<typeof useAuth>["user"];
  userMenuRef: RefObject<HTMLDivElement>;
  open: boolean;
  setOpen: (open: boolean | ((value: boolean) => boolean)) => void;
  logout: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="relative" ref={userMenuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Open user menu"
        className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold transition-all focus:outline-none focus:ring-2 ${
          dark ? "border-white/20 bg-white/10 text-white hover:bg-white/15 focus:ring-white/20" : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20 focus:ring-primary/30"
        }`}
      >
        {initials}
      </button>

      {open && (
        <div className={`absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-md border shadow-2xl ${
          dark ? "border-white/15 bg-[#0a2a56] text-white shadow-slate-950/40" : "border-border/80 bg-popover shadow-black/20"
        }`}>
          <div className={`border-b px-4 py-3 ${dark ? "border-white/10 bg-white/5" : "border-border/60 bg-card/50"}`}>
            <div className="flex items-center gap-2.5">
              <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                dark ? "border-white/20 bg-white/10 text-white" : "border-primary/20 bg-primary/10 text-primary"
              }`}>
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{user?.email}</p>
                <div className="mt-0.5 flex items-center gap-1">
                  <Shield className={`h-3 w-3 ${dark ? "text-blue-100" : "text-primary"}`} />
                  <p className={`text-xs ${dark ? "text-blue-100/80" : "text-muted-foreground"}`}>
                    {ROLE_LABELS[user?.role ?? ""] ?? user?.role}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-1.5">
            <button
              onClick={() => {
                setOpen(false);
                logout();
              }}
              className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                dark ? "hover:bg-white/10" : "hover:bg-accent"
              }`}
            >
              <LogOut className={`h-4 w-4 ${dark ? "text-blue-100/80" : "text-muted-foreground"}`} />
              <span>{t("auth.logout")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
