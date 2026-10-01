import Link from "next/link";
import { cn } from "cn";

/**
 * The FormCraft mark: a marigold index card tilted −8° with an ink
 * border and a hard offset shadow (Part 1 §0).
 */
export function LogoMark({
  size = 22,
  className,
  inverted = false,
}: {
  size?: number;
  className?: string;
  /** On ink backgrounds the shadow turns cream. */
  inverted?: boolean;
}) {
  const shadow = Math.max(2, Math.round(size / 10));
  return (
    <span
      aria-hidden
      className={cn(
        "bg-primary inline-block shrink-0 border-[1.5px]",
        inverted ? "border-transparent" : "border-ink",
        className,
      )}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.26),
        transform: "rotate(-8deg)",
        boxShadow: `${shadow}px ${shadow}px 0 ${inverted ? "#fffaf1" : "var(--shadow-ink)"}`,
      }}
    />
  );
}

/** Mark + "FormCraft" wordmark (Space Grotesk 700, −2% tracking). */
export function Brand({
  href = "/",
  className,
  size = "default",
}: {
  href?: string;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const mark = size === "lg" ? 26 : size === "sm" ? 20 : 22;
  const text =
    size === "lg" ? "text-[24px]" : size === "sm" ? "text-[19px]" : "text-[21px]";
  return (
    <Link
      href={href}
      className={cn(
        "fc-focus font-heading flex items-center gap-2.5 rounded-xs leading-none font-bold tracking-[-0.02em]",
        text,
        className,
      )}
    >
      <LogoMark size={mark} />
      FormCraft
    </Link>
  );
}

/** Full-page loading state: a spinner inside the logo tile. */
export function PageSpinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-[50vh] place-items-center">
      <span className="border-ink bg-primary shadow-card grid size-12 place-items-center rounded-[12px] border-[1.5px]">
        <span className="border-primary-foreground size-5 animate-spin rounded-full border-2 border-t-transparent" />
      </span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
