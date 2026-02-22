"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Building2, LogOut, Shield } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  super_user: "Super User",
  admin: "Admin",
  user: "User",
};

export function Header() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

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

      {/* Right: avatar + dropdown */}
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
                <span>Sign out</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
