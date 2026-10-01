"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

type Variant = "datetime" | "date" | "relative" | "day";

/**
 * Renders a timestamp in the *viewer's* locale and timezone. Server
 * rendering would otherwise format it in the server's zone (UTC in
 * production) and then mismatch on hydration, so the server pass emits
 * a stable UTC rendering and the client swaps in the local one.
 */
export function LocalTime({
  iso,
  variant = "datetime",
  className,
}: {
  iso: string;
  variant?: Variant;
  className?: string;
}) {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const date = new Date(iso);
  const text = isClient ? format(date, variant) : formatUtc(date, variant);

  return (
    <time
      dateTime={iso}
      title={isClient ? date.toLocaleString() : undefined}
      className={className}
    >
      {text}
    </time>
  );
}

function format(date: Date, variant: Variant): string {
  if (variant === "relative") return formatRelative(date);
  if (variant === "day") return formatDay(date);
  return variant === "date"
    ? date.toLocaleDateString(undefined, { dateStyle: "medium" })
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatUtc(date: Date, variant: Variant): string {
  const options: Intl.DateTimeFormatOptions =
    variant === "datetime"
      ? { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }
      : { dateStyle: "medium", timeZone: "UTC" };
  return date.toLocaleString("en-US", options);
}

/** "Today, 2:32 PM" · "Yesterday, 6:48 PM" · "Sep 28, 9:31 AM" (the
 * year only when it isn't this one). */
function formatDay(date: Date): string {
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((startOfToday.getTime() - date.getTime()) / 86_400_000) + 1;
  if (date >= startOfToday) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === startOfToday.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${day}, ${time}`;
}

function formatRelative(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}
