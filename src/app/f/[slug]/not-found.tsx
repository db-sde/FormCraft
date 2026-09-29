import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Form unavailable",
  robots: { index: false },
};

/**
 * What a respondent sees for a link to a form that doesn't exist, was
 * unpublished, or was deleted. Deliberately neutral — respondents
 * aren't FormCraft users, so no dashboard/login links, and no hint
 * about *which* of those it was (that's the creator's business).
 */
export default function FormNotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white p-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
        This form isn&apos;t available
      </h1>
      <p className="max-w-sm text-sm text-neutral-500">
        It may have been closed by its owner, or the link may be incorrect. If you were
        sent this link, check with the person who shared it.
      </p>
    </main>
  );
}
