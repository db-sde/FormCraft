"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { archiveFormAction } from "@/app/(dashboard)/actions";
import { Button, ButtonSpinner } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LocalTime } from "@/components/local-time";
import { toast } from "@/lib/toast";
import type { UpcomingBooking } from "@/domains/forms/queries";

/**
 * Archive and restore for one form (developer spec item 4), with the
 * question archiving asks when bookings are coming up: keep them (their
 * reminders still go out) or go and cancel them first.
 */
export function useArchiveForm(onDone: () => void) {
  const [conflict, setConflict] = useState<{
    formId: string;
    count: number;
    bookings: UpcomingBooking[];
  } | null>(null);
  const [pending, start] = useTransition();

  function run(formId: string, archived: boolean, keepBookings = false) {
    start(async () => {
      const result = await archiveFormAction(formId, archived, keepBookings);
      if (result.ok) {
        setConflict(null);
        toast.success(
          archived
            ? "Archived. Its link now says it's no longer available."
            : "Restored, unpublished. Publish it again when you're ready.",
        );
        onDone();
      } else if ("code" in result && result.code === "upcoming_bookings") {
        setConflict({ formId, count: result.count, bookings: result.bookings });
      } else {
        toast.error(result.message);
      }
    });
  }

  const dialog = (
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This form has upcoming bookings</DialogTitle>
          <DialogDescription>
            {conflict?.count} booking{conflict?.count === 1 ? " is" : "s are"} still to
            come. Cancel {conflict?.count === 1 ? "it" : "them"} first, or keep{" "}
            {conflict?.count === 1 ? "it" : "them"}: attendees still get their reminders
            after the form is archived.
          </DialogDescription>
        </DialogHeader>
        <ul className="border-border divide-border max-h-[220px] divide-y overflow-y-auto rounded-sm border text-sm">
          {conflict?.bookings.map((b) => (
            <li key={b.id} className="flex justify-between gap-3 px-3 py-2">
              <span>{b.attendee_name || "Attendee"}</span>
              <LocalTime iso={b.starts_at} />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button asChild variant="outline">
            <Link href="/bookings">Review bookings</Link>
          </Button>
          <Button
            disabled={pending}
            onClick={() => conflict && run(conflict.formId, true, true)}
          >
            {pending && <ButtonSpinner />} Keep bookings and archive
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { run, dialog, pending };
}
