"use client";

import type { EndingV1 } from "@/domains/forms/schema/v1";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

export function EndingEditor({
  ending,
  onChange,
}: {
  ending: EndingV1;
  onChange: (next: EndingV1) => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4">
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {ending.isDefault ? "Default ending" : "Ending"}
      </span>
      <Textarea
        value={ending.title}
        onChange={(e) => onChange({ ...ending, title: e.target.value })}
        placeholder="Thank you!"
        aria-label="Ending title"
        rows={1}
        className="resize-none border-none px-0 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
      />
      <Textarea
        value={ending.description ?? ""}
        onChange={(e) => onChange({ ...ending, description: e.target.value })}
        placeholder="Description (optional)"
        aria-label="Ending description"
        rows={2}
        className="text-muted-foreground resize-none border-none px-0 shadow-none focus-visible:ring-0"
      />
      <div className="mt-2">
        <Button type="button" disabled className="pointer-events-none">
          {ending.buttonLabel || "Done"}
        </Button>
      </div>
    </div>
  );
}

export function EndingSettingsPanel({
  ending,
  onChange,
}: {
  ending: EndingV1;
  onChange: (next: EndingV1) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs font-medium">Button label</Label>
        <Input
          value={ending.buttonLabel ?? ""}
          placeholder="Done"
          onChange={(e) => onChange({ ...ending, buttonLabel: e.target.value })}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs font-medium">
          Redirect URL (optional)
        </Label>
        <Input
          type="url"
          value={ending.redirectUrl ?? ""}
          placeholder="https://example.com"
          onChange={(e) =>
            onChange({ ...ending, redirectUrl: e.target.value || undefined })
          }
        />
      </div>
    </div>
  );
}
