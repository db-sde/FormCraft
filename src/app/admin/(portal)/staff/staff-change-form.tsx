"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requestStaffChangeAction } from "../../actions";

const ROLES = ["owner", "admin", "support", "billing", "privacy", "read_only"] as const;

export function StaffChangeForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [action, setAction] = useState<"staff.add" | "staff.set_role" | "staff.disable">(
    "staff.add",
  );
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("support");
  const [displayName, setDisplayName] = useState("");
  const [reason, setReason] = useState("");
  const select = "border-input bg-field h-9 rounded-sm border-[1.5px] px-2 text-sm";
  return (
    <form
      className="border-border grid gap-3 rounded-lg border-[1.5px] p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await requestStaffChangeAction({
            action,
            email,
            role: action === "staff.disable" ? undefined : role,
            displayName: displayName || undefined,
            reason,
          });
          if (result.ok) {
            toast.success("Requested. Someone else approves it on Approvals.");
            setEmail("");
            setReason("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      {" "}
      <div className="flex flex-col gap-1">
        <label htmlFor="staff-change" className="text-sm font-semibold">
          Change
        </label>
        <select
          id="staff-change"
          className={select}
          value={action}
          onChange={(e) => setAction(e.target.value as typeof action)}
        >
          <option value="staff.add">Add staff</option>
          <option value="staff.set_role">Change role</option>
          <option value="staff.disable">Disable</option>
        </select>
      </div>{" "}
      <div className="flex flex-col gap-1">
        <label htmlFor="staff-email" className="text-sm font-semibold">
          Their staff email
        </label>
        <Input
          id="staff-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      {action !== "staff.disable" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="staff-role" className="text-sm font-semibold">
            Role
          </label>
          <select
            id="staff-role"
            className={select}
            value={role}
            onChange={(e) => setRole(e.target.value as typeof role)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>
      )}
      {action === "staff.add" && (
        <div className="flex flex-col gap-1">
          <label htmlFor="staff-name" className="text-sm font-semibold">
            Name
          </label>
          <Input
            id="staff-name"
            value={displayName}
            maxLength={80}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
      )}{" "}
      <label
        htmlFor="staff-reason"
        className="flex flex-col gap-1 text-sm font-semibold sm:col-span-2"
      >
        Reason
        <Textarea
          id="staff-reason"
          rows={2}
          required
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <Button
        type="submit"
        disabled={pending}
        className="sm:col-span-2 sm:justify-self-start"
      >
        {pending ? "Requesting…" : "Request change"}
      </Button>
    </form>
  );
}
