import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { bookingByToken } from "@/domains/bookings/server";
import { attendeeMayChange } from "@/domains/bookings/availability";
import { ManageBooking } from "./manage-booking";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
};

/** The attendee's page for one booking (F-27), from the link in their
 * email. No account needed; the token is the key. */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const booking = await bookingByToken(createAdminClient(), token);
  if (!booking) notFound();
  const type = booking.booking_types as {
    name: string;
    location: string | null;
    time_zone: string;
    min_notice_minutes: number;
  };
  const host = booking.host as { full_name: string | null } | null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 px-4 py-12">
      <h1 className="font-heading text-3xl font-bold">{type.name}</h1>
      <ManageBooking
        token={token}
        status={booking.status}
        startsAt={booking.starts_at}
        endsAt={booking.ends_at}
        location={type.location}
        hostName={host?.full_name ?? null}
        typeTimeZone={type.time_zone}
        canChange={
          booking.status === "confirmed" &&
          attendeeMayChange(
            { minNoticeMinutes: type.min_notice_minutes },
            booking.starts_at,
          )
        }
      />
    </main>
  );
}
