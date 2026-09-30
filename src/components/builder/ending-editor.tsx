"use client";

import type { EndingV1, ThemeV1 } from "@/domains/forms/schema/v1";
import { ThemedButton, ThemedSlide } from "./themed-slide";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function EndingEditor({
  ending,
  theme,
  onChange,
}: {
  ending: EndingV1;
  theme: ThemeV1;
  onChange: (next: EndingV1) => void;
}) {
  const editable =
    "resize-none border-none bg-transparent px-0 text-center shadow-none placeholder:text-current placeholder:opacity-40 focus-visible:ring-0 dark:bg-transparent";
  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="text-muted-foreground mb-3 text-xs font-medium">
        {ending.isDefault ? "Default ending" : "Ending"} — shown after the form is
        submitted
      </div>
      <ThemedSlide theme={theme} className="items-center text-center">
        <Textarea
          value={ending.title}
          onChange={(e) => onChange({ ...ending, title: e.target.value })}
          placeholder="Thank you!"
          aria-label="Ending title"
          rows={1}
          className={`${editable} min-h-0 text-2xl font-semibold md:text-2xl`}
        />
        <Textarea
          value={ending.description ?? ""}
          onChange={(e) => onChange({ ...ending, description: e.target.value })}
          placeholder="Add a message (optional)"
          aria-label="Ending description"
          rows={2}
          className={`${editable} min-h-0 opacity-75`}
        />
        {(ending.redirectUrl || ending.buttonLabel) && (
          <ThemedButton theme={theme}>{ending.buttonLabel || "Done"}</ThemedButton>
        )}
      </ThemedSlide>
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
