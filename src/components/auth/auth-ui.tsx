import Link from "next/link";
import { CircleAlert, CircleCheck, Info, Timer } from "lucide-react";
import { cn } from "cn";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared pieces for the auth screens (Part 2 §4.2–4.8): a centred index
 * card with an offset ink shadow, a big title, banners for form-level
 * problems, and errors under their own field.
 */
export function AuthCard({
  title,
  subtitle,
  icon,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  /** A tilted 52px tile above the title (check-email, link expired…). */
  icon?: { node: React.ReactNode; tint?: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="sm:border-ink sm:bg-card flex w-full flex-1 flex-col gap-[22px] sm:flex-none sm:gap-[18px] sm:rounded-xl sm:border-[1.5px] sm:p-7 sm:shadow-[5px_5px_0_var(--shadow-ink)]">
      {icon && (
        <div
          className="border-ink shadow-card grid size-[52px] -rotate-6 place-items-center rounded-[12px] border-[1.5px] text-[#2b2118] [&_svg]:size-6 [&_svg]:stroke-[1.75]"
          style={{ background: icon.tint ?? "var(--accent)" }}
        >
          {icon.node}
        </div>
      )}
      <div className="mt-5 flex flex-col gap-1.5 sm:mt-0">
        <h1 className="font-heading text-[32px] leading-[1.05] font-bold tracking-[-0.03em] sm:text-[28px] sm:leading-[1.1] sm:tracking-[-0.025em]">
          {title}
        </h1>
        {subtitle && (
          <p className="text-muted-foreground text-[15px] leading-normal text-pretty">
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

const TONES = {
  info: {
    icon: Info,
    className:
      "border-[var(--alert-info-border)] bg-[var(--alert-info-bg)] text-[var(--alert-info-fg)]",
  },
  warn: {
    icon: Timer,
    className:
      "border-[#c99a2e] bg-[var(--chip-draft-bg)] text-[#5e4410] dark:text-[var(--chip-draft-fg)]",
  },
  error: {
    icon: CircleAlert,
    className:
      "border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]",
  },
  success: {
    icon: CircleCheck,
    className:
      "border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] text-[var(--alert-success-fg)]",
  },
} as const;

export function AuthNotice({
  tone = "error",
  children,
}: {
  tone?: keyof typeof TONES;
  children: React.ReactNode;
}) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <div
      role={tone === "error" || tone === "warn" ? "alert" : "status"}
      className={cn(
        "flex gap-2.5 rounded-sm border-[1.5px] px-3 py-[11px] text-[13.5px] leading-[1.45]",
        className,
      )}
    >
      <Icon className="mt-px size-[17px] shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function AuthField({
  id,
  label,
  error,
  helper,
  link,
  ...input
}: React.ComponentProps<"input"> & {
  id: string;
  label: string;
  error?: string;
  helper?: string;
  link?: { href: string; label: string };
}) {
  const describedBy = error ? `${id}-error` : helper ? `${id}-help` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id} className="text-sm sm:text-[13.5px]">
          {label}
        </Label>
        {link && (
          <Link
            href={link.href}
            className="fc-focus decoration-primary rounded-xs text-[13.5px] font-semibold underline decoration-2 underline-offset-[3px] sm:text-[13px]"
          >
            {link.label}
          </Link>
        )}
      </div>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="h-12 text-base sm:h-11 sm:text-[15px]"
        {...input}
      />
      {error ? (
        <p
          id={`${id}-error`}
          className="text-destructive flex items-center gap-1.5 text-[12.5px] font-semibold"
        >
          <CircleAlert className="size-3.5 shrink-0" />
          {error}
        </p>
      ) : helper ? (
        <p id={`${id}-help`} className="text-muted-foreground text-[12.5px]">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

export function AuthFooter({
  text,
  link,
}: {
  text: string;
  link: { href: string; label: string };
}) {
  return (
    <p className="text-muted-foreground text-center text-sm">
      {text}{" "}
      <Link
        href={link.href}
        className="fc-focus text-foreground decoration-primary rounded-xs font-bold underline decoration-2 underline-offset-[3px]"
      >
        {link.label}
      </Link>
    </p>
  );
}

/** Pushes the primary button to the bottom of the screen on phones, so a
 * thumb can reach it; on larger screens it sits in the card's flow. */
export function AuthActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-auto flex flex-col gap-[22px] sm:mt-0 sm:gap-[18px]">
      {children}
    </div>
  );
}
