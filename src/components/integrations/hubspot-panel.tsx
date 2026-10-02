"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  saveHubspotSyncAction,
  testHubspotAction,
} from "@/app/(form)/forms/[id]/(sections)/integrations/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/lib/toast";

type Source = { value: string; label: string };

/** HubSpot contact sync (P2.15): which question fills which contact
 * property. Contacts are matched by email (created or updated). */
export function HubspotPanel({
  formId,
  initial,
  sources,
  allowed,
  connected,
}: {
  formId: string;
  initial: Record<string, string> | null;
  sources: Source[];
  allowed: boolean;
  connected: boolean;
}) {
  const [rows, setRows] = useState<{ property: string; source: string }[]>(
    initial
      ? Object.entries(initial).map(([property, source]) => ({ property, source }))
      : [
          {
            property: "email",
            source: sources.find((s) => /email/i.test(s.label))?.value ?? "",
          },
        ],
  );
  const [pending, start] = useTransition();
  if (!allowed && !initial) {
    return (
      <p className="text-muted-foreground text-sm">
        CRM integrations are part of the Business plan.
      </p>
    );
  }
  if (!connected) {
    return (
      <p className="text-muted-foreground text-sm">
        Connect HubSpot in Settings → Connections to send contacts from this form.
      </p>
    );
  }
  const mapping = () =>
    Object.fromEntries(
      rows
        .filter((r) => r.property && r.source)
        .map((r) => [r.property.trim(), r.source]),
    );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-[13px]">
        HubSpot property (internal name, e.g. <code>email</code>, <code>firstname</code>,{" "}
        <code>company</code>) → answer. Email is required.
      </p>
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`HubSpot property ${i + 1}`}
            value={row.property}
            onChange={(e) =>
              setRows(
                rows.map((r, j) => (j === i ? { ...r, property: e.target.value } : r)),
              )
            }
            className="h-[36px] w-[180px] font-mono text-[13px]"
          />
          <span aria-hidden>←</span>
          <Select
            value={row.source}
            onValueChange={(v) =>
              setRows(rows.map((r, j) => (j === i ? { ...r, source: v } : r)))
            }
          >
            <SelectTrigger
              className="h-[36px] min-w-0 flex-1"
              aria-label={`Answer for property ${i + 1}`}
            >
              <SelectValue placeholder="Choose an answer" />
            </SelectTrigger>
            <SelectContent>
              {sources.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove mapping ${i + 1}`}
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, { property: "", source: "" }])}
        >
          <Plus /> Add a property
        </Button>
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await saveHubspotSyncAction(formId, mapping());
              if (result.ok) toast.success("HubSpot sync saved.");
              else toast.error(result.message);
            })
          }
        >
          {pending && <ButtonSpinner />}
          Save mapping
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const result = await testHubspotAction(formId, mapping());
              if (result.ok)
                toast.success("The mapping fits the form and HubSpot accepts the token.");
              else toast.error(result.message);
            })
          }
        >
          Test mapping
        </Button>
        {initial && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await saveHubspotSyncAction(formId, null);
                if (result.ok) toast.success("HubSpot sync turned off.");
                else toast.error(result.message);
              })
            }
          >
            Turn off
          </Button>
        )}
      </div>
    </div>
  );
}
