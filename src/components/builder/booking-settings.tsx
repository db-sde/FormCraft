"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { QuestionV1 } from "@/domains/forms/schema/v1";
import { listBookingTypesAction } from "@/app/(dashboard)/bookings/actions";
import { PanelField, PanelNote, SectionHead } from "./panel-ui";

const NONE = "";

/** Settings for a booking question (F-27): which booking type, and where
 * the attendee's name and email come from. */
export function BookingSettingsPanel({
  question,
  onChange,
  questions,
}: {
  question: Extract<QuestionV1, { type: "booking" }>;
  onChange: (next: QuestionV1) => void;
  questions: { id: string; label: string; type: string }[];
}) {
  const [types, setTypes] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Only the newest request's answer is shown: an older, slower one
    // (from before a type was made) never overwrites it.
    let latest = 0;
    const load = () => {
      const request = ++latest;
      const current = () => !cancelled && request === latest;
      return listBookingTypesAction()
        .then((t) => current() && setTypes(t))
        .catch(() => current() && setTypes((prev) => prev ?? []));
    };
    void load();
    // Booking types are set up on the Bookings page, in another tab
    // (leaving the builder would lose a question that can't save yet):
    // coming back picks up what was made there.
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
    };
  }, []);
  const set = (patch: Record<string, unknown>) =>
    onChange({ ...question, settings: { ...question.settings, ...patch } } as QuestionV1);
  const select = (
    id: string,
    value: string | undefined,
    options: { id: string; label: string }[],
    onPick: (v: string | undefined) => void,
    empty: string,
  ) => (
    <select
      id={id}
      className="border-input bg-field h-[38px] w-full rounded-sm border-[1.5px] px-2 text-sm"
      value={value ?? NONE}
      onChange={(e) => onPick(e.target.value || undefined)}
    >
      <option value={NONE}>{empty}</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
  const names = questions.filter(
    (q) => q.type === "short_text" || q.type === "contact_info",
  );
  const emails = questions.filter((q) => q.type === "email" || q.type === "contact_info");

  return (
    <>
      <SectionHead>Booking</SectionHead>
      <PanelField label="Booking type" htmlFor={`${question.id}-booking-type`}>
        {types === null ? (
          <p className="text-muted-foreground text-sm">Loading…</p>
        ) : types.length === 0 ? (
          <p className="text-sm">
            No booking types yet.{" "}
            <Link
              href="/bookings"
              target="_blank"
              rel="noopener"
              className="font-semibold underline"
            >
              Set one up
            </Link>{" "}
            with hosts and hours (opens in a new tab; come back here when it&apos;s
            saved).
          </p>
        ) : (
          select(
            `${question.id}-booking-type`,
            question.settings.bookingTypeId,
            types.map((t) => ({ id: t.id, label: t.name })),
            (v) => set({ bookingTypeId: v }),
            "Choose a booking type",
          )
        )}
      </PanelField>
      <PanelField
        label="Attendee's name from"
        half
        htmlFor={`${question.id}-booking-name`}
      >
        {select(
          `${question.id}-booking-name`,
          question.settings.nameQuestionId,
          names,
          (v) => set({ nameQuestionId: v }),
          "No name",
        )}
      </PanelField>
      <PanelField
        label="Attendee's email from"
        half
        htmlFor={`${question.id}-booking-email`}
      >
        {select(
          `${question.id}-booking-email`,
          question.settings.emailQuestionId,
          emails,
          (v) => set({ emailQuestionId: v }),
          "No email",
        )}
      </PanelField>
      <PanelNote>
        The time is held when the form is submitted, so two people can&apos;t book the
        same slot. With an email, the attendee gets a confirmation, a reminder and a link
        to move or cancel.
      </PanelNote>
    </>
  );
}
