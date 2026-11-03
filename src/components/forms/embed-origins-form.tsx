"use client";

import { useState, useTransition } from "react";
import { saveEmbedOriginsAction } from "@/app/(form)/forms/[id]/(sections)/share/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "@/lib/toast";

/** Share → Embed: which sites may show this form in a frame. Limiting
 * it stops other sites framing the form (and its payment step) under
 * their own content. */
export function EmbedOriginsForm({
  formId,
  initial,
}: {
  formId: string;
  initial: string[] | null;
}) {
  const [limited, setLimited] = useState(initial !== null);
  const [text, setText] = useState((initial ?? []).join("\n"));
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveEmbedOriginsAction(formId, limited ? text : null);
          if (!r.ok) return void toast.error(r.message);
          setText((r.origins ?? []).join("\n"));
          toast.success(
            limited ? "Only those sites can embed it now." : "Any site can embed it.",
          );
        });
      }}
    >
      <span className="text-sm font-semibold">Where it can be embedded</span>
      <div className="flex flex-wrap gap-4 text-[13px]">
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={!limited} onChange={() => setLimited(false)} />
          Any website
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" checked={limited} onChange={() => setLimited(true)} />
          Only these websites
        </label>
      </div>
      {limited && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="embed-origins">Websites, one per line</Label>
          <textarea
            id="embed-origins"
            rows={3}
            value={text}
            placeholder="https://www.example.com"
            onChange={(e) => setText(e.target.value)}
            className="border-input bg-background rounded-sm border-[1.5px] px-3 py-2 font-mono text-[13px]"
          />
          <span className="text-muted-foreground text-xs">
            Other sites can&apos;t show the form in a frame. Its own link still works
            everywhere. Changes apply within a minute.
          </span>
        </div>
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={pending}
      >
        {pending && <ButtonSpinner />}
        Save
      </Button>
    </form>
  );
}
