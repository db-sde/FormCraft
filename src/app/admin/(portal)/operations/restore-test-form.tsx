"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { recordRestoreTestAction } from "../../actions";

/** Record a restore drill: which backup, where it went, what was checked. */
export function RestoreTestForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [backupTime, setBackupTime] = useState("");
  const [restoredTo, setRestoredTo] = useState("");
  const [checks, setChecks] = useState("");
  const [evidence, setEvidence] = useState("");
  const [succeeded, setSucceeded] = useState(true);
  const field = "flex flex-col gap-1";
  return (
    <form
      className="border-border grid gap-3 rounded-lg border-[1.5px] p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await recordRestoreTestAction({
            backupTime: backupTime || null,
            restoredTo,
            checks,
            evidenceUrl: evidence || null,
            succeeded,
          });
          if (result.ok) {
            toast.success("Restore drill recorded.");
            setChecks("");
            setEvidence("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold sm:col-span-2">Record a restore drill</h2>
      <div className={field}>
        <label htmlFor="rt-backup" className="text-sm font-semibold">
          Backup restored (time)
        </label>
        <Input
          id="rt-backup"
          type="datetime-local"
          value={backupTime}
          onChange={(e) => setBackupTime(e.target.value)}
        />
      </div>
      <div className={field}>
        <label htmlFor="rt-to" className="text-sm font-semibold">
          Restored into
        </label>
        <Input
          id="rt-to"
          required
          minLength={2}
          maxLength={200}
          placeholder="Spare project formcraft-restore"
          value={restoredTo}
          onChange={(e) => setRestoredTo(e.target.value)}
        />
      </div>
      <div className={`${field} sm:col-span-2`}>
        <label htmlFor="rt-checks" className="text-sm font-semibold">
          What was checked
        </label>
        <Textarea
          id="rt-checks"
          rows={3}
          required
          minLength={5}
          maxLength={2000}
          placeholder="Row counts match, a form opens, a response exports…"
          value={checks}
          onChange={(e) => setChecks(e.target.value)}
        />
      </div>
      <div className={field}>
        <label htmlFor="rt-evidence" className="text-sm font-semibold">
          Evidence link (https, optional)
        </label>
        <Input
          id="rt-evidence"
          type="url"
          value={evidence}
          onChange={(e) => setEvidence(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 self-end text-sm font-semibold">
        <input
          type="checkbox"
          checked={succeeded}
          onChange={(e) => setSucceeded(e.target.checked)}
        />
        The restore worked
      </label>
      <Button
        type="submit"
        disabled={pending}
        className="sm:col-span-2 sm:justify-self-start"
      >
        Record drill
      </Button>
    </form>
  );
}
