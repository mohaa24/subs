import type { LucideIcon } from "lucide-react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  ClipboardList,
  Landmark,
  LayoutDashboard,
  ReceiptText,
  Settings,
  Users,
  WalletCards,
} from "lucide-react";

export type QuickAction = {
  actionKey: string;
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

const action = (actionKey: string, title: string, description: string, href: string, icon: LucideIcon, tone: string): QuickAction => ({
  actionKey, title, description, href, icon, tone,
});

export const SIDEBAR_QUICK_ACTIONS: QuickAction[] = [
  action("nav-dashboard", "Dashboard", "View your organization overview", "/", LayoutDashboard, "text-blue-600 bg-blue-500/10"),
  action("nav-manage-members", "Manage Members", "Manage memberships", "/members", Users, "text-indigo-600 bg-indigo-500/10"),
  action("nav-people-profile", "People Profile", "Manage people profiles", "/persons", Users, "text-indigo-600 bg-indigo-500/10"),
  action("nav-member-transactions", "Member Transactions", "View payment history", "/payments", Users, "text-indigo-600 bg-indigo-500/10"),
  action("nav-member-payments", "Member Payments", "Record and review member payments", "/payments", ArrowDownToLine, "text-emerald-600 bg-emerald-500/10"),
  action("nav-income-accounts", "Income Accounts", "Record income and collections", "/cash-in", ArrowDownToLine, "text-emerald-600 bg-emerald-500/10"),
  action("nav-expense-accounts", "Expense Accounts", "Record expenses and settlements", "/cash-out", ArrowUpFromLine, "text-rose-600 bg-rose-500/10"),
  action("nav-banking", "Banking", "Manage cash and bank accounts", "/banking", Landmark, "text-cyan-600 bg-cyan-500/10"),
  action("nav-special-funds", "Special Funds", "Manage special funds", "/funds", Landmark, "text-violet-600 bg-violet-500/10"),
  action("nav-receivable", "Receivable", "Manage money to collect", "/receivables", ReceiptText, "text-cyan-600 bg-cyan-500/10"),
  action("nav-payable", "Payable", "Manage money to pay", "/payables", ClipboardList, "text-orange-600 bg-orange-500/10"),
  action("nav-chart-of-accounts", "Chart of Accounts", "Manage accounts", "/accounting", WalletCards, "text-blue-600 bg-blue-500/10"),
  action("nav-account-transactions", "Transactions", "View accounting transactions", "/accounting", WalletCards, "text-blue-600 bg-blue-500/10"),
  action("nav-member-reports", "Member Reports", "View member reports", "/reports", BarChart3, "text-amber-600 bg-amber-500/10"),
  action("nav-periodic-payments", "Periodic Payments", "View periodic payments", "/reports/payments", BarChart3, "text-amber-600 bg-amber-500/10"),
  action("nav-finance-reports", "Finance Reports", "View finance reports", "/accounting", BarChart3, "text-amber-600 bg-amber-500/10"),
  action("nav-administration", "Administration", "Manage administration settings", "/organizations", Settings, "text-slate-600 bg-slate-500/10"),
  action("nav-user-roles", "User & Roles", "Manage users and roles", "/users", Settings, "text-slate-600 bg-slate-500/10"),
  action("nav-form-settings", "Form Settings", "Configure forms", "/settings/form-config", Settings, "text-slate-600 bg-slate-500/10"),
  action("nav-zones", "Zones", "Manage zones", "/settings/zones", Settings, "text-slate-600 bg-slate-500/10"),
  action("nav-due-types", "Due Types", "Manage due types", "/settings/due-types", Settings, "text-slate-600 bg-slate-500/10"),
];

export const quickActionByKey = (actionKey: string) => SIDEBAR_QUICK_ACTIONS.find((action) => action.actionKey === actionKey);
