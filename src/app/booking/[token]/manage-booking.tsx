"use client";

import { useState, useTransition } from "react";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { SlotPicker } from "@/components/bookings/slot-picker";

const fmt = (iso: string, timeZone?: string) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone,
  }).format(new Date(iso));

export function ManageBooking({
  token: initialToken,
  status: initialStatus,
  startsAt: initialStart,
  location,
  hostName,
  canChange,
}: {
  token: string;
  status: string;
  startsAt: string;
  endsAt: string;
  location: string | null;
  hostName: string | null;
  typeTimeZone: string;
  canChange: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const [startsAt, setStartsAt] = useState(initialStart);
  const [token, setToken] = useState(initialToken);
  const [moving, setMoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/bookings/manage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, ...body }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
      startsAt?: string;
      token?: string;
      slots?: string[];
      timeZone?: string;
    };
    if (!res.ok)
      throw new Error(data.error?.message ?? "Something went wrong. Try again.");
    return data;
  };

  if (status === "cancelled") {
    return <p role="status">This booking is cancelled.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col gap-1.5">
        <div>
          <dt className="text-muted-foreground text-sm">When</dt>
          <dd className="text-lg font-semibold">{fmt(startsAt)}</dd>
        </div>
        {hostName && (
          <div>
            <dt className="text-muted-foreground text-sm">With</dt>
            <dd>{hostName}</dd>
          </div>
        )}
        {location && (
          <div>
            <dt className="text-muted-foreground text-sm">Where</dt>
            <dd className="break-words">{location}</dd>
          </div>
        )}
      </dl>
      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
      {!canChange ? (
        <p className="text-muted-foreground text-sm">
          It&apos;s too close to the time to change this online. Contact the host.
        </p>
      ) : moving ? (
        <SlotPicker
          load={async (from) => {
            const data = await call({ action: "slots", from });
            return { slots: data.slots ?? [], timeZone: data.timeZone ?? "UTC" };
          }}
          onPick={(slot) =>
            start(async () => {
              try {
                const data = await call({ action: "reschedule", start: slot });
                if (data.startsAt) setStartsAt(data.startsAt);
                if (data.token) setToken(data.token);
                setMoving(false);
                setMessage("Moved. We've emailed you the new time.");
              } catch (error) {
                setMessage((error as Error).message);
              }
            })
          }
          busy={pending}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMoving(true)}>Pick another time</Button>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                try {
                  await call({ action: "cancel" });
                  setStatus("cancelled");
                } catch (error) {
                  setMessage((error as Error).message);
                }
              })
            }
          >
            {pending && <ButtonSpinner />}
            Cancel booking
          </Button>
        </div>
      )}
    </div>
  );
}
