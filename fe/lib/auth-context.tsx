"use client";

import React, { createContext, useContext, useCallback, useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { api, type Organization, type User } from "./api";

const AuthContext = createContext<{
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refetch: () => Promise<void>;
  organizations: Organization[];
  activeOrganization: Organization | null;
  switchOrganization: (organizationId: string) => void;
  hasPermission: (...permissions: string[]) => boolean;
} | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [rawUser, setRawUser] = useState<User | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrganization, setActiveOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refetch = useCallback(async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    if (!token) {
      setRawUser(null);
      setLoading(false);
      return;
    }
    try {
      const u = await api<User>("/auth/me");
      setRawUser(u);
    } catch {
      localStorage.removeItem("token");
      setRawUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useEffect(() => {
    if (rawUser?.role !== "super_user") {
      setOrganizations([]);
      setActiveOrganization(null);
      if (rawUser) localStorage.removeItem("activeOrganizationId");
      return;
    }
    let cancelled = false;
    api<Organization[]>("/organizations")
      .then((items) => {
        if (cancelled) return;
        setOrganizations(items);
        const storedId = localStorage.getItem("activeOrganizationId");
        const selected = items.find((item) => item.id === storedId && item.isActive !== false)
          ?? items.find((item) => item.isActive !== false)
          ?? null;
        setActiveOrganization(selected);
        if (selected) localStorage.setItem("activeOrganizationId", selected.id);
        else localStorage.removeItem("activeOrganizationId");
      })
      .catch(() => {
        if (!cancelled) {
          setOrganizations([]);
          setActiveOrganization(null);
        }
      });
    return () => { cancelled = true; };
  }, [rawUser]);

  const user = useMemo<User | null>(() => {
    if (!rawUser || rawUser.role !== "super_user" || !activeOrganization) return rawUser;
    return {
      ...rawUser,
      organizationId: activeOrganization.id,
      organization: {
        id: activeOrganization.id,
        name: activeOrganization.name,
        slug: activeOrganization.slug,
        defaultMembershipFee: activeOrganization.defaultMembershipFee,
        isActive: activeOrganization.isActive,
      },
    };
  }, [rawUser, activeOrganization]);

  const login = useCallback(
    async (email: string, password: string) => {
      const { token, user: u } = await api<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem("token", token);
      if (u.role !== "super_user") localStorage.removeItem("activeOrganizationId");
      setRawUser(u);
      router.push("/");
    },
    [router]
  );

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    localStorage.removeItem("activeOrganizationId");
    setRawUser(null);
    router.push("/login");
  }, [router]);

  const switchOrganization = useCallback((organizationId: string) => {
    const selected = organizations.find((organization) => organization.id === organizationId && organization.isActive !== false);
    if (!selected) return;
    localStorage.setItem("activeOrganizationId", selected.id);
    setActiveOrganization(selected);
    window.location.reload();
  }, [organizations]);

  const hasPermission = useCallback((...permissions: string[]) => {
    if (!user) return false;
    if (user.role === "super_user" || user.role === "admin") return true;
    return permissions.some((permission) => user.permissions?.includes(permission));
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refetch, organizations, activeOrganization, switchOrganization, hasPermission }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
