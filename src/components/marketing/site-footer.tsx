import Link from "next/link";
import { LogoMark } from "@/components/app-shell/brand";
import { SOC2_SHORT } from "@/domains/marketing/claims";

/** The footer on FormCraft's public pages: links, and the hosting line
 * (the approved SOC 2 wording, which names the providers). */
export function SiteFooter() {
  return (
    <footer className="text-muted-foreground mx-auto box-content flex max-w-[1200px] flex-col gap-3 px-[clamp(16px,4vw,40px)] py-7 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-x-7 gap-y-3">
        <span className="text-foreground flex items-center gap-2 font-bold">
          <LogoMark size={14} />
          FormCraft
        </span>
        <span>© 2026 FormCraft</span>
        <div className="flex-1" />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/pricing" className="hover:underline">
            Pricing
          </Link>
          <Link href="/templates" className="hover:underline">
            Templates
          </Link>
          <Link href="/developers" className="hover:underline">
            Developers
          </Link>
          <Link href="/security" className="hover:underline">
            Security
          </Link>
          <Link href="/legal/subprocessors" className="hover:underline">
            Subprocessors
          </Link>
        </nav>
      </div>
      <p>{SOC2_SHORT}</p>
    </footer>
  );
}
