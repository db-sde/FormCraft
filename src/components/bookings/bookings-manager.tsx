"use client";

import { useState, useTransition } from "react";
import { CalendarCheck, Plus } from "lucide-react";
import {
  archiveBookingTypeAction,
  cancelBookingAction,
  chooseCalendarAction,
  disconnectCalendarAction,
  saveBookingTypeAction,
  type BookingTypeInput,
} from "@/app/(dashboard)/bookings/actions";
import type { WeeklyWindow } from "@/domains/bookings/availability";
import { Button, ButtonSpinner } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { LocalTime } from "@/components/local-time";
import { toast } from "@/lib/toast";
import { NotSetUpYet } from "@/components/not-set-up-yet";

type TypeRow = BookingTypeInput & { id: string };
type Person = { id: string; name: string };

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function blankType(userId: string): BookingTypeInput {
  return {
    name: "",
    durationMinutes: 30,
    intervalMinutes: null,
    bufferBeforeMinutes: 0,
    bufferAfterMinutes: 0,
    minNoticeMinutes: 120,
    maxDaysAhead: 30,
    timeZone:
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        : "UTC",
    weekly: [1, 2, 3, 4, 5].map((day) => ({ day, start: "09:00", end: "17:00" })),
    blockedDates: [],
    location: null,
    reminders: true,
    hostIds: [userId],
  };
}

function TypeEditor({
  id,
  initial,
  people,
  onDone,
}: {
  id: string | null;
  initial: BookingTypeInput;
  people: Person[];
  onDone: () => void;
}) {
  const [v, setV] = useState(initial);
  const [blockedDraft, setBlockedDraft] = useState("");
  const [pending, start] = useTransition();
  const set = (patch: Partial<BookingTypeInput>) => setV((x) => ({ ...x, ...patch }));
  const windowFor = (day: number) => v.weekly.find((w) => w.day === day);
  const setDay = (day: number, w: Omit<WeeklyWindow, "day"> | null) =>
    set({
      weekly: [
        ...v.weekly.filter((x) => x.day !== day),
        ...(w ? [{ day, ...w }] : []),
      ].sort((a, b) => a.day - b.day),
    });
  const num = (
    key: keyof BookingTypeInput,
    label: string,
    min: number,
    max: number,
    help?: string,
  ) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`bt-${key}`}>{label}</Label>
      <Input
        id={`bt-${key}`}
        type="number"
        min={min}
        max={max}
        value={(v[key] as number | null) ?? ""}
        onChange={(e) =>
          set({
            [key]: e.target.value === "" ? null : Number(e.target.value),
          } as Partial<BookingTypeInput>)
        }
      />
      {help && <span className="text-muted-foreground text-xs">{help}</span>}
    </div>
  );

  return (
    <form
      className="border-ink bg-card flex flex-col gap-4 rounded-lg border-[1.5px] p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const result = await saveBookingTypeAction(id, v);
          if (result.ok) {
            toast.success("Saved.");
            onDone();
          } else toast.error(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="bt-name">Name</Label>
          <Input
            id="bt-name"
            maxLength={120}
            value={v.name}
            placeholder="Intro call"
            onChange={(e) => set({ name: e.target.value })}
          />
        </div>
        {num("durationMinutes", "Length (minutes)", 5, 480)}
        {num("intervalMinutes", "Start every (minutes)", 5, 480, "Empty: the length.")}
        {num("bufferBeforeMinutes", "Free before (minutes)", 0, 240)}
        {num("bufferAfterMinutes", "Free after (minutes)", 0, 240)}
        {num(
          "minNoticeMinutes",
          "Minimum notice (minutes)",
          0,
          20160,
          "Also the latest people can cancel or move.",
        )}
        {num("maxDaysAhead", "Book up to (days ahead)", 1, 365)}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bt-zone">Time zone</Label>
          <Input
            id="bt-zone"
            value={v.timeZone}
            onChange={(e) => set({ timeZone: e.target.value })}
          />
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold">Hours</legend>
        {DAYS.map((name, day) => {
          const w = windowFor(day);
          return (
            <div key={day} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex w-32 items-center gap-2">
                <Checkbox
                  checked={Boolean(w)}
                  onCheckedChange={(on) =>
                    setDay(day, on ? { start: "09:00", end: "17:00" } : null)
                  }
                />
                {name}
              </label>
              {w && (
                <>
                  <Input
                    type="time"
                    aria-label={`${name} from`}
                    className="h-8 w-28"
                    value={w.start}
                    onChange={(e) => setDay(day, { start: e.target.value, end: w.end })}
                  />
                  –
                  <Input
                    type="time"
                    aria-label={`${name} until`}
                    className="h-8 w-28"
                    value={w.end === "24:00" ? "23:59" : w.end}
                    onChange={(e) => setDay(day, { start: w.start, end: e.target.value })}
                  />
                </>
              )}
            </div>
          );
        })}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Days off</span>
        <div className="flex flex-wrap items-center gap-2">
          {v.blockedDates.map((d) => (
            <button
              key={d}
              type="button"
              className="bg-secondary rounded-full px-2.5 py-0.5 text-xs font-semibold"
              aria-label={`Remove ${d}`}
              onClick={() => set({ blockedDates: v.blockedDates.filter((x) => x !== d) })}
            >
              {d} ×
            </button>
          ))}
          <Input
            type="date"
            aria-label="Add a day off"
            className="h-8 w-40"
            value={blockedDraft}
            onChange={(e) => setBlockedDraft(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!blockedDraft}
            onClick={() => {
              set({
                blockedDates: [...new Set([...v.blockedDates, blockedDraft])].sort(),
              });
              setBlockedDraft("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bt-location">Where</Label>
          <Input
            id="bt-location"
            maxLength={500}
            value={v.location ?? ""}
            placeholder="An address or a meeting link"
            onChange={(e) => set({ location: e.target.value || null })}
          />
        </div>
        <label className="flex items-center gap-2 self-end text-sm">
          <Switch
            checked={v.reminders}
            onCheckedChange={(reminders) => set({ reminders })}
          />
          Remind attendees a day before
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-bold">Hosts</span>
        <span className="text-muted-foreground text-xs">
          Any free host can take a booking; the one with the fewest upcoming goes first.
        </span>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={v.hostIds.includes(p.id)}
                onCheckedChange={(on) =>
                  set({
                    hostIds: on
                      ? [...v.hostIds, p.id]
                      : v.hostIds.filter((h) => h !== p.id),
                  })
                }
              />
              {p.name}
            </label>
          ))}
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <ButtonSpinner />}
          Save booking type
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function BookingsManager({
  canEdit,
  userId,
  types,
  people,
  bookings,
  calendar,
}: {
  canEdit: boolean;
  userId: string;
  types: TypeRow[];
  people: Person[];
  bookings: {
    id: string;
    startsAt: string;
    endsAt: string;
    type: string;
    attendee: string;
    host: string;
    mine: boolean;
  }[];
  calendar: {
    available: boolean;
    connected: boolean;
    status: string | null;
    label: string | null;
    calendarId: string | null;
    calendars: { id: string; name: string; primary: boolean }[];
    justConnected: boolean;
  };
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, start] = useTransition();
  const run = (work: () => Promise<{ ok: boolean; message?: string }>, done: string) =>
    start(async () => {
      const result = await work();
      if (result.ok) toast.success(done);
      else toast.error(result.message ?? "Something went wrong.");
    });
  const hostNames = (ids: string[]) =>
    ids
      .map((id) => people.find((p) => p.id === id)?.name ?? "Former teammate")
      .join(", ");

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="types-heading" className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 id="types-heading" className="font-heading text-2xl font-bold">
            Booking types
          </h2>
          {canEdit && editing === null && (
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <Plus className="size-4" />
              New booking type
            </Button>
          )}
        </div>
        {editing === "new" && (
          <TypeEditor
            id={null}
            initial={blankType(userId)}
            people={people}
            onDone={() => setEditing(null)}
          />
        )}
        {types.length === 0 && editing !== "new" && (
          <p className="text-muted-foreground text-sm">None yet.</p>
        )}
        {types.map((t) =>
          editing === t.id ? (
            <TypeEditor
              key={t.id}
              id={t.id}
              initial={t}
              people={people}
              onDone={() => setEditing(null)}
            />
          ) : (
            <div
              key={t.id}
              className="border-ink bg-card flex flex-wrap items-center gap-3 rounded-lg border-[1.5px] px-4 py-3"
            >
              <CalendarCheck className="text-muted-foreground size-5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <b>{t.name}</b>
                <span className="text-muted-foreground text-xs">
                  {t.durationMinutes} min · {t.timeZone} · {hostNames(t.hostIds)}
                </span>
              </div>
              {canEdit && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(t.id)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => run(() => archiveBookingTypeAction(t.id), "Archived.")}
                  >
                    Archive
                  </Button>
                </>
              )}
            </div>
          ),
        )}
      </section>

      <section aria-labelledby="calendar-heading" className="flex flex-col gap-2">
        <h2 id="calendar-heading" className="font-heading text-2xl font-bold">
          Your calendar
        </h2>
        {!calendar.available ? (
          <NotSetUpYet feature="Google Calendar">
            Bookings still work: they&apos;re listed here and checked against each other
            so no one is double-booked.
          </NotSetUpYet>
        ) : !calendar.connected ? (
          <div className="flex flex-col items-start gap-2">
            <p className="text-muted-foreground text-sm">
              Connect your Google Calendar: your busy times are skipped, and bookings you
              host are added to it with an invitation to the attendee.
            </p>
            <a
              href="/api/connectors/google_calendar/authorize?returnTo=/bookings"
              className="border-ink bg-card fc-focus rounded-sm border-[1.5px] px-3 py-1.5 text-sm font-semibold"
            >
              Connect Google Calendar
            </a>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <p className="text-sm">
              {calendar.status === "ok" ? "Connected" : "Needs reconnecting"}
              {calendar.label ? ` as ${calendar.label}` : ""}.
              {calendar.justConnected && " Done."}
            </p>
            {calendar.calendars.length > 0 && (
              <label className="flex flex-col gap-1 text-sm font-semibold">
                Calendar for bookings
                <select
                  className="border-input bg-field h-9 rounded-sm border-[1.5px] px-2 font-normal"
                  value={calendar.calendarId ?? "primary"}
                  onChange={(e) =>
                    run(() => chooseCalendarAction(e.target.value), "Saved.")
                  }
                >
                  {calendar.calendars.map((c) => (
                    <option key={c.id} value={c.primary ? "primary" : c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {calendar.status !== "ok" && (
              <a
                href="/api/connectors/google_calendar/authorize?returnTo=/bookings"
                className="text-sm font-semibold underline"
              >
                Reconnect
              </a>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(disconnectCalendarAction, "Disconnected.")}
            >
              Disconnect
            </Button>
          </div>
        )}
      </section>

      <section aria-labelledby="upcoming-heading" className="flex flex-col gap-2">
        <h2 id="upcoming-heading" className="font-heading text-2xl font-bold">
          Upcoming
        </h2>
        {bookings.length === 0 ? (
          <p className="text-muted-foreground text-sm">No upcoming bookings.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {bookings.map((b) => (
              <li
                key={b.id}
                className="border-border bg-card flex flex-wrap items-center gap-3 rounded-sm border px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1">
                  <b>
                    <LocalTime iso={b.startsAt} />
                  </b>{" "}
                  · {b.type} · {b.attendee} · host {b.host}
                </span>
                {(b.mine || canEdit) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => cancelBookingAction(b.id),
                        "Cancelled; the attendee was told.",
                      )
                    }
                  >
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
