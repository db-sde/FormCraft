"use client";

import { useState, useTransition } from "react";
import { Copy, Trash2, X } from "lucide-react";
import {
  changeRoleAction,
  inviteMemberAction,
  leaveWorkspaceAction,
  removeMemberAction,
  revokeInvitationAction,
  setMemberPermissionsAction,
} from "@/app/(dashboard)/settings/team-actions";
import type {
  InvitableRole,
  PendingInvitation,
  TeamMember,
  WorkspaceRole,
} from "@/domains/workspaces/team";
import { SettingsSection } from "@/components/dashboard/account-settings";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

// Kept here (not imported from the domain module, which is server-only).
const ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};
const INVITABLE: InvitableRole[] = ["admin", "editor", "viewer"];

function RoleSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: InvitableRole;
  onChange: (role: InvitableRole) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as InvitableRole)}
      disabled={disabled}
    >
      <SelectTrigger className="h-[38px] w-[120px]" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {INVITABLE.map((r) => (
          <SelectItem key={r} value={r}>
            {ROLE_LABEL[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Settings → Members (PRD P2.19). Admins invite, change roles and
 * remove people; everyone sees who's here. Every change is decided on
 * the server (roles in row-level security, seats from the plan). */
export function TeamSettings({
  members,
  invitations,
  currentUserId,
  myRole,
  seatLimit,
}: {
  members: TeamMember[];
  invitations: PendingInvitation[];
  currentUserId: string;
  myRole: WorkspaceRole;
  seatLimit: number | null;
}) {
  const isAdmin = myRole === "owner" || myRole === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<InvitableRole>("editor");
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done?: string) =>
    start(async () => {
      const result = await work();
      if (result.ok) {
        if (done || result.message) toast.success(result.message ?? done ?? "Done.");
      } else {
        toast.error(result.message ?? "Something went wrong.");
      }
    });

  const seats = members.length + invitations.length;

  return (
    <>
      {isAdmin && (
        <SettingsSection
          title="Invite people"
          description={
            seatLimit === null
              ? "Invitations last 7 days and only work for the address you enter."
              : `${seats} of ${seatLimit} seat${seatLimit === 1 ? "" : "s"} used, counting open invitations.`
          }
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setLink(null);
              start(async () => {
                const result = await inviteMemberAction(email, role);
                if (result.ok) {
                  toast.success(result.message ?? "Invited.");
                  setEmail("");
                  if (result.link) setLink(result.link);
                } else {
                  toast.error(result.message);
                }
              });
            }}
          >
            <Label htmlFor="invite-email">Email</Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                placeholder="teammate@example.com"
                onChange={(e) => setEmail(e.target.value)}
                className="h-[38px] flex-1"
              />
              <RoleSelect
                value={role}
                onChange={setRole}
                label="Role for the invitation"
              />
              <Button type="submit" disabled={pending || !email}>
                {pending && <ButtonSpinner />}
                Invite
              </Button>
            </div>
            {link && (
              <div className="bg-background flex items-center gap-2 rounded-sm px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-mono">{link}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard?.writeText(link);
                    toast.success("Link copied.");
                  }}
                >
                  <Copy /> Copy link
                </Button>
              </div>
            )}
          </form>
        </SettingsSection>
      )}

      <SettingsSection
        title="Members"
        description={
          <>
            <b className="text-foreground">Admins</b> manage members and everything else.{" "}
            <b className="text-foreground">Editors</b> build, publish and see responses.{" "}
            <b className="text-foreground">Viewers</b> see forms and responses but change
            nothing.
          </>
        }
        wide
        last={invitations.length === 0 && myRole === "owner"}
      >
        <ul className="border-ink bg-card overflow-hidden rounded-lg border-[1.5px]">
          {members.map((m) => {
            const isYou = m.userId === currentUserId;
            const display = isYou ? `${m.name || "You"} (you)` : m.name || "Teammate";
            return (
              <li
                key={m.userId}
                className="border-border flex flex-wrap items-center gap-3 border-b px-3.5 py-3 last:border-b-0"
              >
                <span
                  aria-hidden
                  className="border-ink bg-primary text-primary-foreground grid size-[34px] shrink-0 place-items-center rounded-full border-[1.5px] text-xs font-bold"
                >
                  {(display.trim()[0] ?? "?").toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-[1.3]">
                  <b className="truncate text-sm">{display}</b>
                  <span className="text-muted-foreground truncate text-[12.5px]">
                    {m.email}
                  </span>
                </span>
                {isAdmin && m.role !== "owner" && !isYou ? (
                  <>
                    <RoleSelect
                      value={m.role as InvitableRole}
                      disabled={pending}
                      label={`Role for ${display}`}
                      onChange={(next) =>
                        run(() => changeRoleAction(m.userId, next), "Role changed.")
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${display}`}
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`Remove ${display} from this workspace?`)) {
                          run(() => removeMemberAction(m.userId), "Removed.");
                        }
                      }}
                    >
                      <Trash2 />
                    </Button>
                    <PermissionsEditor
                      member={m}
                      disabled={pending}
                      onSave={(overrides) =>
                        run(
                          () => setMemberPermissionsAction(m.userId, overrides),
                          "Permissions saved.",
                        )
                      }
                    />
                  </>
                ) : (
                  <span className="text-[13.5px] font-semibold">
                    {ROLE_LABEL[m.role]}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </SettingsSection>

      {isAdmin && invitations.length > 0 && (
        <SettingsSection title="Invitations" last={myRole === "owner"}>
          <ul className="flex flex-col gap-1.5">
            {invitations.map((i) => (
              <li
                key={i.id}
                className="bg-background flex items-center gap-3 rounded-sm px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{i.email}</span>
                <span className="text-muted-foreground text-[12.5px]">
                  {ROLE_LABEL[i.role]} · until{" "}
                  {new Date(i.expiresAt).toLocaleDateString("en", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Cancel the invitation for ${i.email}`}
                  disabled={pending}
                  onClick={() =>
                    run(() => revokeInvitationAction(i.id), "Invitation cancelled.")
                  }
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </SettingsSection>
      )}

      {myRole !== "owner" && (
        <SettingsSection title="Leave workspace" danger last>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  "Leave this workspace? You'll need a new invitation to come back.",
                )
              ) {
                run(() => leaveWorkspaceAction());
              }
            }}
          >
            Leave workspace
          </Button>
        </SettingsSection>
      )}
    </>
  );
}

const PERMISSION_ROWS: [string, string][] = [
  ["view_responses", "See responses"],
  ["export_responses", "Export responses"],
  ["publish", "Publish forms"],
  ["manage_integrations", "Manage integrations"],
];

/** What one editor or viewer may do (P3.15), beyond their role's defaults. */
function PermissionsEditor({
  member,
  disabled,
  onSave,
}: {
  member: TeamMember;
  disabled: boolean;
  onSave: (overrides: Record<string, boolean>) => void;
}) {
  const defaults = (p: string) => member.role === "editor" || p === "view_responses";
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      PERMISSION_ROWS.map(([p]) => [p, member.permissions[p] ?? defaults(p)]),
    ),
  );
  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Permissions
      </Button>
    );
  }
  return (
    <div className="bg-background basis-full rounded-sm p-3">
      <div className="grid gap-1.5 sm:grid-cols-2">
        {PERMISSION_ROWS.map(([p, label]) => (
          <label key={p} className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={values[p]}
              onChange={(e) => setValues({ ...values, [p]: e.target.checked })}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            // Store only what differs from the role's defaults.
            onSave(
              Object.fromEntries(
                Object.entries(values).filter(([p, v]) => v !== defaults(p)),
              ),
            );
            setOpen(false);
          }}
        >
          Save permissions
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
