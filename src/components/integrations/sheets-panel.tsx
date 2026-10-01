"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Sheet, Unplug } from "lucide-react";
import type { SheetsConnection, SyncLogEntry } from "@/domains/sheets";
import {
  setSpreadsheetIdAction,
  setSheetsEnabledAction,
  disconnectSheetsAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LocalTime } from "@/components/local-time";
import { DeliveryRow } from "./delivery-row";

/** Pasting the whole sheet URL works too: keep the id between /d/ and /edit. */
function spreadsheetIdFrom(input: string): string {
  const match = /\/d\/([a-zA-Z0-9_-]+)/.exec(input);
  return (match ? match[1] : input).trim();
}

/** Google Sheets (Part 5 §5.8): connect, pick a spreadsheet, enable,
 * disconnect, and the sync log. */
export function SheetsPanel({
  formId,
  configured,
  connection,
  initialSyncLog,
}: {
  formId: string;
  /** Whether GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI are set on the
   * server — if not, connecting is unavailable until deploy-time setup
   * (see DECISIONS.md). */
  configured: boolean;
  connection: SheetsConnection | null;
  initialSyncLog: SyncLogEntry[];
}) {
  const [spreadsheetId, setSpreadsheetIdInput] = useState(
    connection?.spreadsheetId ?? "",
  );
  const [enabled, setEnabled] = useState(connection?.enabled ?? true);
  const [pending, startTransition] = useTransition();
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  function handleSaveSpreadsheetId() {
    const id = spreadsheetIdFrom(spreadsheetId);
    setSpreadsheetIdInput(id);
    startTransition(async () => {
      const result = await setSpreadsheetIdAction(formId, id);
      if (result.ok)
        toast.success("Spreadsheet saved.", {
          description: "New responses will be added to it.",
        });
      else
        toast.error("Couldn't save the spreadsheet.", {
          description: result.message ?? "Try again.",
        });
    });
  }

  function handleToggle(next: boolean) {
    setEnabled(next);
    startTransition(async () => {
      await setSheetsEnabledAction(formId, next);
    });
  }

  function handleDisconnect() {
    startTransition(async () => {
      const result = await disconnectSheetsAction(formId);
      setConfirmingDisconnect(false);
      if (result.ok) toast.success("Google Sheets disconnected.");
      else toast.error("Couldn't disconnect.", { description: "Try again." });
    });
  }

  if (!configured) {
    return (
      <Alert variant="info">
        <AlertTitle>Google Sheets isn&apos;t set up here yet.</AlertTitle>
        <AlertDescription>
          An administrator needs to add Google API credentials to this FormCraft server
          before anyone can connect.
        </AlertDescription>
      </Alert>
    );
  }

  if (!connection) {
    return (
      <div className="border-ink bg-card flex flex-col items-start gap-3 rounded-lg border-[1.5px] p-[18px]">
        <span className="text-muted-foreground text-sm leading-normal">
          Connect your Google account and pick a spreadsheet. Each completed response
          becomes a new row, and the column headers are your questions.
        </span>
        <Button asChild className="h-[42px]">
          <a href={`/api/integrations/google/authorize?formId=${formId}`}>
            <Sheet /> Connect Google Sheets
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="border-ink bg-card shadow-card rounded-lg border-[1.5px]">
      <div className="border-border flex flex-wrap items-center gap-3 border-b-[1.5px] p-3.5">
        <span className="flex flex-1 items-center gap-2">
          <span className="size-2 rounded-full bg-[var(--chip-live-dot)] shadow-[0_0_0_3px_var(--chip-live-bg)]" />
          <b className="font-heading text-[17px]">Connected</b>
        </span>
        <label className="text-muted-foreground flex items-center gap-2 text-[13px] font-semibold">
          {enabled ? "Enabled" : "Paused"}
          <Switch checked={enabled} onCheckedChange={handleToggle} />
        </label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-[34px]"
          onClick={() => setConfirmingDisconnect(true)}
          disabled={pending}
        >
          Disconnect
        </Button>
      </div>
      <form
        className="flex flex-col gap-1.5 p-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (spreadsheetId.trim()) handleSaveSpreadsheetId();
        }}
      >
        <label htmlFor="spreadsheet-id" className="text-[13.5px] font-semibold">
          Spreadsheet ID
        </label>
        <div className="flex gap-2">
          <Input
            id="spreadsheet-id"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetIdInput(e.target.value)}
            spellCheck={false}
            className="h-10 font-mono text-[13px]"
          />
          <Button
            type="submit"
            className="h-10"
            data-loading={pending || undefined}
            disabled={pending || !spreadsheetId.trim()}
          >
            {pending && <ButtonSpinner />}
            Save
          </Button>
        </div>
        <span className="text-muted-foreground text-[12.5px]">
          It&apos;s in the sheet&apos;s URL, between{" "}
          <span className="font-mono">/d/</span> and{" "}
          <span className="font-mono">/edit</span>. Pasting the whole link works too.
        </span>
      </form>
      <div className="flex flex-col gap-0.5 px-3.5 pt-1 pb-3">
        <span className="text-muted-foreground pb-1 text-[11px] font-bold tracking-[0.08em] uppercase">
          Sync log
        </span>
        {initialSyncLog.length === 0 ? (
          <span className="text-muted-foreground py-2 text-[13.5px]">
            No syncs yet. The next completed response will be added to your sheet.
          </span>
        ) : (
          initialSyncLog
            .slice(0, 5)
            .map((entry) => (
              <DeliveryRow
                key={entry.id}
                when={<LocalTime iso={entry.createdAt} variant="day" />}
                detail={`${entry.attemptCount} attempt${entry.attemptCount === 1 ? "" : "s"}`}
                error={entry.status !== "succeeded" ? entry.lastError : null}
                status={entry.status}
              />
            ))
        )}
      </div>

      <AlertDialog open={confirmingDisconnect} onOpenChange={setConfirmingDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              <Unplug />
            </AlertDialogMedia>
            <AlertDialogTitle>Disconnect Google Sheets?</AlertDialogTitle>
            <AlertDialogDescription>
              New responses won&apos;t be added to your spreadsheet. Rows already there
              stay put. You can reconnect any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                handleDisconnect();
              }}
            >
              {pending && <ButtonSpinner />}
              {pending ? "Disconnecting…" : "Disconnect"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
