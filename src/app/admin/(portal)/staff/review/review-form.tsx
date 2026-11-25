"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { recordAccessReviewAction } from "../../../actions";

/** The owner ticks each active staff member to confirm they still need
 * their access, then records the review. */
export function AccessReviewForm({
  people,
}: {
  people: { user_id: string; display_name: string; role: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState("");
  return (
    <form
      className="border-border flex flex-col gap-3 rounded-lg border-[1.5px] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await recordAccessReviewAction({
            reviewed: [...ticked],
            notes,
          });
          if (result.ok) {
            toast.success("Access review recorded.");
            setTicked(new Set());
            setNotes("");
            router.refresh();
          } else toast.error(result.error);
        });
      }}
    >
      <h2 className="font-semibold">Record this month&apos;s review</h2>
      <p className="text-muted-foreground text-sm">
        Tick each person who still needs their role. To change or remove someone&apos;s
        access, ask for it on Staff (it needs a second person) and note it here.
      </p>
      <fieldset className="flex flex-col gap-1">
        <legend className="sr-only">Staff reviewed</legend>
        {people.map((p) => (
          <label key={p.user_id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={ticked.has(p.user_id)}
              onChange={(e) => {
                const next = new Set(ticked);
                if (e.target.checked) next.add(p.user_id);
                else next.delete(p.user_id);
                setTicked(next);
              }}
            />
            {p.display_name} still needs {p.role.replace("_", " ")} access
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1">
        <label htmlFor="ar-notes" className="text-sm font-semibold">
          Notes (changes asked for, anything odd)
        </label>
        <Textarea
          id="ar-notes"
          rows={2}
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Record review
      </Button>
    </form>
  );
}
