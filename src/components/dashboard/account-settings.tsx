"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  deleteAccountAction,
  renameWorkspaceAction,
  updateEmailAction,
  updateNameAction,
  updatePasswordAction,
  type AccountResult,
} from "@/app/(dashboard)/settings/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2 } from "lucide-react";
import { cn } from "cn";

function initials(name: string): string {
  const parts = name
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** One settings row (Part 3 §10.2): a label column on the left, the
 * controls on the right, a divider underneath. */
export function SettingsSection({
  title,
  description,
  children,
  danger,
  last,
  wide,
}: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  danger?: boolean;
  last?: boolean;
  wide?: boolean;
}) {
  return (
    <section
      className={cn(
        "grid gap-4 md:grid-cols-[260px_minmax(0,1fr)] md:gap-8",
        !last && "border-border border-b pb-[26px]",
      )}
    >
      <div>
        <h2
          className={cn(
            "font-heading text-lg font-bold tracking-normal",
            danger && "text-destructive",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="text-muted-foreground mt-1.5 text-sm leading-normal">
            {description}
          </p>
        )}
      </div>
      <div className={wide ? "max-w-[640px]" : "max-w-[560px]"}>{children}</div>
    </section>
  );
}

function useRun() {
  const [pending, startTransition] = useTransition();
  function run(
    action: () => Promise<AccountResult>,
    success: string,
    after?: () => void,
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(result.message ?? success);
        after?.();
      } else {
        toast.error(result.message, { duration: 8000 });
      }
    });
  }
  return [pending, run] as const;
}

function ProfileSection({ name, email }: { name: string; email: string }) {
  const [pending, run] = useRun();
  const [fullName, setFullName] = useState(name);
  const [newEmail, setNewEmail] = useState(email);
  const changed = fullName.trim() !== name || newEmail.trim() !== email;

  return (
    <SettingsSection title="Profile" description="How you appear to your teammates.">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (fullName.trim() !== name) {
              const result = await updateNameAction(fullName);
              if (!result.ok) return result;
            }
            if (newEmail.trim() !== email) return updateEmailAction(newEmail);
            return { ok: true, message: "Saved." };
          }, "Saved.");
        }}
      >
        <div
          aria-hidden
          className="border-ink bg-primary font-heading text-primary-foreground grid size-16 place-items-center rounded-full border-[1.5px] text-xl font-bold"
        >
          {initials(fullName || email)}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="full-name">Full name</Label>
          <Input
            id="full-name"
            value={fullName}
            maxLength={100}
            autoComplete="name"
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={newEmail}
            autoComplete="email"
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <p className="text-muted-foreground text-[12.5px]">
            Changing it sends a confirmation link to the new address.
          </p>
        </div>
        <Button
          type="submit"
          className="self-start"
          disabled={pending || !changed}
          data-loading={pending || undefined}
        >
          {pending && <ButtonSpinner />}
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </form>
    </SettingsSection>
  );
}

function PasswordSection() {
  const [pending, run] = useRun();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && confirmPassword !== password;

  return (
    <SettingsSection title="Password" description="At least 8 characters.">
      <form
        className="grid gap-4 sm:grid-cols-2 sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (password !== confirmPassword) {
            toast.error("The passwords don't match.", { duration: 8000 });
            return;
          }
          run(
            () => updatePasswordAction(password, current),
            "Password updated.",
            () => {
              setCurrent("");
              setPassword("");
              setConfirmPassword("");
            },
          );
        }}
      >
        <div className="grid gap-1.5 sm:col-span-2">
          <Label htmlFor="current-password">Current password</Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="confirm-password">Confirm</Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          className="justify-self-start font-semibold"
          disabled={pending || password.length < 8 || !current}
          data-loading={pending || undefined}
        >
          {pending && <ButtonSpinner />}
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </SettingsSection>
  );
}

const THEMES = [
  { value: "light", name: "Light", bg: "#f5efe4", side: "#fffaf1", ink: "#2b2118" },
  { value: "dark", name: "Dark", bg: "#1c1713", side: "#26201a", ink: "#f3ebdf" },
  {
    value: "system",
    name: "Match system",
    bg: "linear-gradient(90deg,#f5efe4 50%,#1c1713 50%)",
    side: "#cdbda4",
    ink: "#6f6254",
  },
] as const;

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? "system") : "system";

  return (
    <SettingsSection
      title="Appearance"
      description="Only affects the FormCraft app, not your forms."
    >
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="grid gap-3 sm:grid-cols-3"
      >
        {THEMES.map((t) => {
          const selected = current === t.value;
          return (
            <button
              key={t.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setTheme(t.value)}
              className={cn(
                "fc-focus bg-card flex flex-col gap-2 rounded-lg border-[1.5px] p-2 text-left",
                selected ? "border-ink shadow-card" : "border-border hover:border-ink",
              )}
            >
              <span
                aria-hidden
                className="border-input flex h-[70px] gap-1.5 rounded-sm border p-2"
                style={{ background: t.bg }}
              >
                <span className="w-[26px] rounded-[3px]" style={{ background: t.side }} />
                <span className="flex flex-1 flex-col gap-[5px]">
                  <span
                    className="h-2 w-3/5 rounded-[2px]"
                    style={{ background: t.ink }}
                  />
                  <span
                    className="h-[22px] rounded-[3px]"
                    style={{ background: t.side }}
                  />
                </span>
              </span>
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span
                  aria-hidden
                  className={cn(
                    "border-ink size-4 rounded-full",
                    selected ? "border-[5px]" : "border-[1.5px]",
                  )}
                />
                {t.name}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsSection>
  );
}

function DeleteAccountSection({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

  return (
    <SettingsSection
      title="Delete account"
      description="This can't be undone."
      danger
      last
    >
      <div className="border-destructive flex flex-col items-start justify-between gap-4 rounded-lg border-[1.5px] bg-[#fdf1ee] p-4 sm:flex-row sm:items-center dark:bg-[var(--alert-error-bg)]">
        <span className="text-sm leading-normal">
          Deletes your account, the workspaces you own, and all of their forms and
          responses. Live links stop working.
        </span>
        <Button variant="destructive" className="shrink-0" onClick={() => setOpen(true)}>
          Delete account…
        </Button>
      </div>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Trash2 />
            </AlertDialogMedia>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              All your forms stop working immediately and every response, lead and
              uploaded file is deleted. Type <strong>{email}</strong> to confirm.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            aria-label="Type your email to confirm"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={
                pending || confirmEmail.trim().toLowerCase() !== email.toLowerCase()
              }
              data-loading={pending || undefined}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAccountAction(confirmEmail);
                  if (result && !result.ok)
                    toast.error(result.message, { duration: 8000 });
                })
              }
            >
              {pending && <ButtonSpinner />}
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsSection>
  );
}

export function AccountSettings({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex flex-col gap-[26px]">
      <ProfileSection name={name} email={email} />
      <PasswordSection />
      <AppearanceSection />
      <DeleteAccountSection email={email} />
    </div>
  );
}

export function WorkspaceSettings({
  workspaceId,
  name,
  isOwner,
}: {
  workspaceId: string;
  name: string;
  isOwner: boolean;
}) {
  const [pending, run] = useRun();
  const [value, setValue] = useState(name);

  return (
    <div className="flex flex-col gap-[26px]">
      <SettingsSection
        title="Workspace name"
        description="Shown on the dashboard and in emails."
        wide
        last
      >
        <form
          className="flex gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => renameWorkspaceAction(workspaceId, value), "Workspace renamed.");
          }}
        >
          <Input
            aria-label="Workspace name"
            value={value}
            maxLength={80}
            disabled={!isOwner}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button
            type="submit"
            variant="outline"
            className="h-[42px] font-semibold"
            disabled={!isOwner || pending || !value.trim() || value.trim() === name}
            data-loading={pending || undefined}
          >
            {pending && <ButtonSpinner />}
            {pending ? "Renaming…" : "Rename"}
          </Button>
        </form>
        {!isOwner && (
          <p className="text-muted-foreground mt-2 text-[12.5px]">
            Only the workspace owner can rename it.
          </p>
        )}
      </SettingsSection>
    </div>
  );
}
