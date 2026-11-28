/** Plain-language names for staff permissions (private.role_permissions).
 * A key with no label here is shown as its code. */
export const PERMISSION_LABELS: Record<string, string> = {
  "portal.access": "Use the staff portal",
  "customers.read": "Look up customers and workspaces",
  "customers.status": "Suspend or restore a customer",
  "plans.read": "See plans and entitlements",
  "plans.change": "Change a customer's plan or limits",
  "ai.settings": "Change AI models, limits and pauses",
  "privacy.manage": "Handle privacy requests",
  "comms.send": "Send notices and messages to customers",
  "ops.read": "See operations, alerts and backups",
  "ops.record": "Record restore tests and drills",
  "staff.manage": "Add, change and disable staff",
  "approvals.decide": "Approve or reject change requests",
  "audit.read": "Read the audit trail",
};

export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key;
}
