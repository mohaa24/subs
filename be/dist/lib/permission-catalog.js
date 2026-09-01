"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMISSION_KEYS = exports.PERMISSION_CATALOG = void 0;
exports.expandPermissions = expandPermissions;
exports.PERMISSION_CATALOG = [
    { category: "Dashboard", key: "VIEW_DASHBOARD", label: "View dashboard", description: "View organisation totals and activity." },
    { category: "Dashboard", key: "ADD_ACTIVITY_NOTE", label: "Add activity notes", description: "Add notes to people and memberships.", implies: ["VIEW_DASHBOARD"] },
    { category: "People & memberships", key: "VIEW_PERSONS", label: "View people", description: "View and search people profiles." },
    { category: "People & memberships", key: "CREATE_PERSON", label: "Add people", description: "Create new people profiles.", implies: ["VIEW_PERSONS"] },
    { category: "People & memberships", key: "EDIT_PERSON", label: "Edit people", description: "Edit or archive people profiles.", implies: ["VIEW_PERSONS"] },
    { category: "People & memberships", key: "VIEW_MEMBERSHIPS", label: "View memberships", description: "View and search memberships." },
    { category: "People & memberships", key: "CREATE_MEMBERSHIP", label: "Add memberships", description: "Create new memberships.", implies: ["VIEW_MEMBERSHIPS", "VIEW_PERSONS"] },
    { category: "People & memberships", key: "EDIT_MEMBERSHIP", label: "Edit memberships", description: "Edit or archive memberships.", implies: ["VIEW_MEMBERSHIPS"] },
    { category: "Member dues & payments", key: "VIEW_MEMBER_DUES", label: "View member dues", description: "View balances, dues and statements." },
    { category: "Member dues & payments", key: "GENERATE_MEMBER_DUES", label: "Generate dues", description: "Run organisation due generation.", implies: ["VIEW_MEMBER_DUES"] },
    { category: "Member dues & payments", key: "MANAGE_MEMBER_DUES", label: "Manage dues", description: "Add, edit, mark overdue and apply credit.", implies: ["VIEW_MEMBER_DUES"] },
    { category: "Member dues & payments", key: "VIEW_MEMBER_PAYMENTS", label: "View payments", description: "View payment history and receipts." },
    { category: "Member dues & payments", key: "RECEIVE_MEMBER_PAYMENT", label: "Receive payments", description: "Record member payments.", implies: ["VIEW_MEMBER_PAYMENTS", "VIEW_MEMBER_DUES"] },
    { category: "Member dues & payments", key: "REVERSE_MEMBER_PAYMENT", label: "Reverse payments", description: "Reverse member payments.", implies: ["VIEW_MEMBER_PAYMENTS"] },
    { category: "Member dues & payments", key: "SEND_MEMBER_MESSAGE", label: "Send receipts and reminders", description: "Send payment-related SMS.", implies: ["VIEW_MEMBER_PAYMENTS"] },
    { category: "Finance", key: "VIEW_CASH_IN", label: "View Cash In", description: "View income and incoming cash." },
    { category: "Finance", key: "RECEIVE_OPERATING_INCOME", label: "Receive operating income", description: "Post income receipts.", implies: ["VIEW_CASH_IN"] },
    { category: "Finance", key: "VIEW_CASH_OUT", label: "View Cash Out", description: "View expenses and outgoing cash." },
    { category: "Finance", key: "PAY_OPERATING_EXPENSE", label: "Pay expenses", description: "Post operating expenses.", implies: ["VIEW_CASH_OUT"] },
    { category: "Finance", key: "REVERSE_CASH_TRANSACTION", label: "Reverse cash transactions", description: "Reverse Cash In or Cash Out entries.", implies: ["VIEW_CASH_IN", "VIEW_CASH_OUT"] },
    { category: "Finance", key: "VIEW_BANKING", label: "View banking", description: "View bank and cash accounts." },
    { category: "Finance", key: "MANAGE_BANKING", label: "Manage banking", description: "Create accounts, transactions and transfers.", implies: ["VIEW_BANKING"] },
    { category: "Finance", key: "VIEW_SPECIAL_FUNDS", label: "View special funds", description: "View funds and their activity." },
    { category: "Finance", key: "MANAGE_SPECIAL_FUNDS", label: "Manage special funds", description: "Create funds, collect, pay, transfer and reverse.", implies: ["VIEW_SPECIAL_FUNDS"] },
    { category: "Finance", key: "VIEW_RECEIVABLES", label: "View receivables", description: "View receivable accounts." },
    { category: "Finance", key: "MANAGE_RECEIVABLES", label: "Manage receivables", description: "Create, collect and close receivables.", implies: ["VIEW_RECEIVABLES", "VIEW_CASH_IN"] },
    { category: "Finance", key: "VIEW_PAYABLES", label: "View payables", description: "View payable accounts." },
    { category: "Finance", key: "MANAGE_PAYABLES", label: "Manage payables", description: "Create, repay and close payables.", implies: ["VIEW_PAYABLES"] },
    { category: "Accounting", key: "VIEW_CHART_OF_ACCOUNTS", label: "View chart of accounts", description: "View ledgers and balances." },
    { category: "Accounting", key: "MANAGE_CHART_OF_ACCOUNTS", label: "Manage chart of accounts", description: "Create and edit user-managed accounts.", implies: ["VIEW_CHART_OF_ACCOUNTS"] },
    { category: "Accounting", key: "VIEW_JOURNALS", label: "View journals", description: "View general ledger journal entries." },
    { category: "Announcements", key: "VIEW_ANNOUNCEMENTS", label: "View announcements", description: "View drafts and sent announcements." },
    { category: "Announcements", key: "MANAGE_ANNOUNCEMENTS", label: "Create and send announcements", description: "Manage drafts, templates, groups and sending.", implies: ["VIEW_ANNOUNCEMENTS"] },
    { category: "Distributions", key: "VIEW_DISTRIBUTIONS", label: "View distributions", description: "View distribution campaigns." },
    { category: "Distributions", key: "MANAGE_DISTRIBUTIONS", label: "Manage distributions", description: "Create, edit, scan and complete distributions.", implies: ["VIEW_DISTRIBUTIONS"] },
    { category: "Reports", key: "VIEW_MEMBER_REPORTS", label: "View member reports", description: "Open member and membership reports." },
    { category: "Reports", key: "EXPORT_MEMBER_REPORTS", label: "Export member reports", description: "Download member report data.", implies: ["VIEW_MEMBER_REPORTS"] },
    { category: "Reports", key: "VIEW_FINANCIAL_REPORTS", label: "View financial reports", description: "Open P&L, balance sheet and finance reports." },
    { category: "Reports", key: "EXPORT_FINANCIAL_REPORTS", label: "Print and export financial reports", description: "Print or export financial report data.", implies: ["VIEW_FINANCIAL_REPORTS"] },
    { category: "Administration", key: "VIEW_USERS", label: "View users", description: "View organisation users and roles." },
    { category: "Administration", key: "MANAGE_USERS", label: "Manage users", description: "Create users and assign roles.", implies: ["VIEW_USERS"] },
    { category: "Administration", key: "MANAGE_ROLES", label: "Manage roles", description: "Create and edit organisation roles.", implies: ["VIEW_USERS"] },
    { category: "Administration", key: "VIEW_ORGANIZATION_SETTINGS", label: "View organisation settings", description: "View organisation configuration." },
    { category: "Administration", key: "EDIT_ORGANIZATION_SETTINGS", label: "Edit organisation settings", description: "Update organisation and receipt settings.", implies: ["VIEW_ORGANIZATION_SETTINGS"] },
    { category: "Administration", key: "MANAGE_DUE_TYPES", label: "Manage due types", description: "Configure organisation due types.", implies: ["VIEW_ORGANIZATION_SETTINGS"] },
    { category: "Administration", key: "MANAGE_ZONES", label: "Manage zones", description: "Configure organisation zones.", implies: ["VIEW_ORGANIZATION_SETTINGS"] },
    { category: "Administration", key: "MANAGE_FORM_SETTINGS", label: "Manage form settings", description: "Configure people and membership forms.", implies: ["VIEW_ORGANIZATION_SETTINGS"] },
    { category: "Administration", key: "VIEW_SMS_SETTINGS", label: "View SMS settings", description: "View quota, usage and templates." },
    { category: "Administration", key: "MANAGE_SMS_TEMPLATES", label: "Manage SMS templates", description: "Edit organisation SMS templates.", implies: ["VIEW_SMS_SETTINGS"] },
    { category: "Administration", key: "VIEW_AUDIT_LOG", label: "View audit log", description: "View organisation change history." },
];
exports.PERMISSION_KEYS = new Set(exports.PERMISSION_CATALOG.map((item) => item.key));
function expandPermissions(permissions) {
    const expanded = new Set(permissions.filter((permission) => exports.PERMISSION_KEYS.has(permission)));
    let changed = true;
    while (changed) {
        changed = false;
        for (const item of exports.PERMISSION_CATALOG) {
            if (!expanded.has(item.key))
                continue;
            for (const implied of "implies" in item ? item.implies : []) {
                if (!expanded.has(implied)) {
                    expanded.add(implied);
                    changed = true;
                }
            }
        }
    }
    return [...expanded];
}
