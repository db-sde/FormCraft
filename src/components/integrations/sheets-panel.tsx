"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Unlink } from "lucide-react";
import type { SheetsConnection, SyncLogEntry } from "@/domains/sheets";
import {
  setSpreadsheetIdAction,
  setSheetsEnabledAction,
  disconnectSheetsAction,
} from "@/app/(dashboard)/forms/[id]/integrations/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LocalTime } from "@/components/local-time";

const STATUS_VARIANT: Record<
  SyncLogEntry["status"],
  "default" | "secondary" | "destructive"
> = {
  succeeded: "default",
  pending: "secondary",
  failed: "destructive",
  exhausted: "destructive",
};

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

  function handleSaveSpreadsheetId() {
    startTransition(async () => {
      const result = await setSpreadsheetIdAction(formId, spreadsheetId);
      if (result.ok) toast.success("Spreadsheet connected");
      else toast.error(result.message ?? "Failed to save spreadsheet ID");
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
      await disconnectSheetsAction(formId);
      toast.success("Disconnected from Google Sheets");
    });
  }

  if (!configured) {
    return (
      <Alert>
        <AlertTitle>Google Sheets isn&apos;t set up on this deployment</AlertTitle>
        <AlertDescription>
          Connecting Sheets needs a Google Cloud OAuth client. Set
          `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and
          `GOOGLE_OAUTH_REDIRECT_URI` (see `.env.example`) at deploy time to enable this.
        </AlertDescription>
      </Alert>
    );
  }

  if (!connection) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between py-6">
          <p className="text-muted-foreground text-sm">
            Automatically add a row to a Google Sheet every time someone completes this
            form.
          </p>
          <Button asChild>
            <a href={`/api/integrations/google/authorize?formId=${formId}`}>
              Connect Google Sheets
            </a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Connected</CardTitle>
          <div className="flex items-center gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={handleToggle}
              aria-label="Enabled"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDisconnect}
              disabled={pending}
              aria-label="Disconnect Google Sheets"
            >
              <Unlink className="size-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            placeholder="Spreadsheet ID (from the sheet's URL, between /d/ and /edit)"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetIdInput(e.target.value)}
          />
          <Button
            type="button"
            onClick={handleSaveSpreadsheetId}
            disabled={pending || !spreadsheetId}
          >
            Save
          </Button>
        </CardContent>
      </Card>

      <div>
        <h3 className="mb-2 text-sm font-medium">Sync log</h3>
        {initialSyncLog.length === 0 ? (
          <p className="text-muted-foreground text-xs">No syncs yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {initialSyncLog.slice(0, 5).map((entry) => (
              <div key={entry.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  <LocalTime iso={entry.createdAt} />
                </span>
                <div className="flex items-center gap-2">
                  {entry.attemptCount > 1 && (
                    <span className="text-muted-foreground">
                      attempt {entry.attemptCount}
                    </span>
                  )}
                  <Badge variant={STATUS_VARIANT[entry.status]}>{entry.status}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
