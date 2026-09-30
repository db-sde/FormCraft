"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { KeyRound, Mail, Trash2, UserRound } from "lucide-react";
import {
  deleteAccountAction,
  updateEmailAction,
  updateNameAction,
  updatePasswordAction,
  type AccountResult,
} from "@/app/(dashboard)/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function Card({
  icon: Icon,
  title,
  description,
  children,
  danger,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`bg-card rounded-xl border p-5 shadow-xs sm:p-6 ${danger ? "border-destructive/30" : ""}`}
    >
      <div className="mb-4 flex items-start gap-3">
        <span
          className={`grid size-9 shrink-0 place-items-center rounded-lg ${danger ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}
        >
          <Icon className="size-4" />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-muted-foreground text-sm">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export function AccountSettings({ name, email }: { name: string; email: string }) {
  const [pending, startTransition] = useTransition();
  const [fullName, setFullName] = useState(name);
  const [newEmail, setNewEmail] = useState(email);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");

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
        toast.error(result.message);
      }
    });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <Card icon={UserRound} title="Profile" description="How you appear in FormCraft.">
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateNameAction(fullName), "Name updated");
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="full-name">Full name</Label>
            <Input
              id="full-name"
              value={fullName}
              maxLength={100}
              autoComplete="name"
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || fullName.trim() === name}>
            Save
          </Button>
        </form>
      </Card>

      <Card
        icon={Mail}
        title="Email"
        description="Used to sign in and for response notifications."
      >
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => updateEmailAction(newEmail), "Check your inbox");
          }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={newEmail}
              autoComplete="email"
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || newEmail.trim() === email}>
            Change email
          </Button>
        </form>
        <p className="text-muted-foreground mt-2 text-xs">
          We&apos;ll email a confirmation link to the new address; nothing changes until
          you click it.
        </p>
      </Card>

      <Card icon={KeyRound} title="Password" description="At least 8 characters.">
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== confirmPassword) {
              toast.error("The passwords don't match.");
              return;
            }
            run(
              () => updatePasswordAction(password),
              "Password updated",
              () => {
                setPassword("");
                setConfirmPassword("");
              },
            );
          }}
        >
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
            <Label htmlFor="confirm-password">Confirm password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={pending || password.length < 8}>
            Update
          </Button>
        </form>
      </Card>

      <Card
        icon={Trash2}
        title="Delete account"
        description="Permanently deletes your account, every form, all responses and leads, and uploaded files. This can't be undone."
        danger
      >
        <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
          Delete my account
        </Button>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
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
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteAccountAction(confirmEmail);
                  if (result && !result.ok) toast.error(result.message);
                })
              }
            >
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
