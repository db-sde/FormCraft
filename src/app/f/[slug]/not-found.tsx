import type { Metadata } from "next";
import Link from "next/link";
import { Link2Off } from "lucide-react";
import { Brand, LogoMark } from "@/components/app-shell/brand";

export const metadata: Metadata = {
  title: { absolute: "This form isn't available" },
  robots: { index: false },
};

/**
 * What a respondent sees for a link to a form that doesn't exist, was
 * unpublished, or was deleted (Part 6 §6.1): FormCraft-branded, never
 * themed, and no hint about *which* of those it was (that's the
 * creator's business). Always light — respondents aren't app users.
 */
export default function FormNotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-[#f5efe4] text-[#2b2118]">
      <header className="hidden px-7 py-5 sm:block">
        <Brand href="/" size="sm" />
      </header>
      <main className="flex flex-1 flex-col justify-center gap-4 px-6 pt-16 pb-7 sm:items-center sm:pt-0 sm:text-center">
        <div aria-hidden className="relative h-24 w-[120px] sm:hidden">
          <div className="absolute top-3 left-0 h-[74px] w-24 -rotate-8 rounded-lg border-[1.5px] border-[#2b2118] bg-[#fffaf1]" />
          <div className="absolute top-1 left-6 grid h-[74px] w-24 rotate-5 place-items-center rounded-lg border-[1.5px] border-dashed border-[#2b2118] bg-[#efe6d6]">
            <Link2Off className="size-7 text-[#6f6254]" />
          </div>
        </div>
        <h1 className="font-heading text-[32px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[40px]">
          This form isn&apos;t available
        </h1>
        <p className="max-w-[460px] text-[15.5px] leading-[1.55] text-[#6f6254] sm:text-base">
          It may have been unpublished or deleted, or the link might be mistyped. If
          someone sent it to you, ask them for a fresh link.
        </p>
        <Link
          href="/"
          className="mt-1.5 hidden h-11 items-center rounded-[6px] border-[1.5px] border-[#2b2118] bg-[#fffaf1] px-[18px] text-[14.5px] font-semibold sm:flex"
        >
          Make your own form
        </Link>
      </main>
      <Link
        href="/"
        className="mb-7 flex items-center justify-center gap-2 text-[13.5px] font-semibold text-[#6f6254] sm:hidden"
      >
        <LogoMark size={12} />
        Make your own form with FormCraft
      </Link>
    </div>
  );
}
