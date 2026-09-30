import Link from "next/link";
import { cn } from "cn";

/** FormCraft wordmark with its logo tile. */
export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}
    >
      <span
        aria-hidden
        className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg text-sm font-bold shadow-sm"
      >
        F
      </span>
      FormCraft
    </Link>
  );
}
