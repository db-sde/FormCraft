"use client";

import { useCallback } from "react";
import { CalendarCheck } from "lucide-react";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { SlotPicker } from "@/components/bookings/slot-picker";
import { formatBookingAnswer } from "@/domains/responses/format";

/**
 * A booking question (F-27): pick a free time. The answer is the slot's
 * start (UTC) and the zone it was shown in; the server holds and
 * confirms it when the form is submitted, so a time taken in the
 * meantime comes back as an error on this question.
 */
export function BookingInput({
  question,
  value,
  onChange,
  getResponseId,
}: {
  question: Extract<QuestionV1, { type: "booking" }>;
  value: unknown;
  onChange: (value: unknown) => void;
  getResponseId?: () => Promise<string>;
}) {
  const load = useCallback(
    async (from: string) => {
      if (!getResponseId) return { slots: [], timeZone: "UTC" };
      const responseId = await getResponseId();
      const qs = new URLSearchParams({
        response: responseId,
        question: question.id,
        from,
      });
      const res = await fetch(`/api/bookings/slots?${qs}`);
      if (!res.ok) throw new Error("slots");
      return (await res.json()) as { slots: string[]; timeZone: string };
    },
    [getResponseId, question.id],
  );
  const picked = (value as { start?: string } | null)?.start;

  if (!getResponseId) {
    return (
      <div className="flex max-w-(--st-tile-max) items-center gap-3 rounded-(--st-tile-br) border-[1.5px] border-dashed border-(--st-line) p-4 text-[14.5px] text-(--st-muted)">
        <CalendarCheck aria-hidden className="size-5 shrink-0" />
        Free times from your booking type appear here on the live form.
      </div>
    );
  }
  return (
    <div className="flex max-w-[640px] flex-col gap-3 text-(--st-text)">
      {picked && (
        <p role="status" className="text-[15px] font-semibold">
          Chosen: {formatBookingAnswer(value)}
        </p>
      )}
      <SlotPicker
        load={load}
        selected={picked}
        onPick={(start) =>
          onChange({
            start,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          })
        }
      />
    </div>
  );
}
