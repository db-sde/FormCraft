/** What staff see for each kind of drill (private.ops_drills.kind). */
export const DRILL_LABEL: Record<string, string> = {
  webhook_outage: "Webhook destination down",
  email_outage: "Email provider down",
  scheduler_outage: "Scheduler stopped",
  ai_outage: "AI provider down",
  staff_lockout: "Staff locked out / account compromised",
  secret_rotation: "Secret rotation",
  incident_exercise: "Incident exercise",
};
