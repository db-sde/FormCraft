import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/** Inline banners (Part 1 §3): tinted fill, 1.5px coloured border,
 * 18px icon, bold title over the body. */
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-sm border-[1.5px] px-3.5 py-3 text-left text-[13.5px] leading-[1.45] has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-24 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:mt-px *:[svg]:text-current *:[svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default: "border-ink bg-card text-card-foreground",
        info: "border-[var(--alert-info-border)] bg-[var(--alert-info-bg)] text-[var(--alert-info-fg)]",
        success:
          "border-[var(--alert-success-border)] bg-[var(--alert-success-bg)] text-[var(--alert-success-fg)]",
        warning:
          "border-[var(--alert-warning-border)] bg-[var(--alert-warning-bg)] text-[var(--alert-warning-fg)]",
        destructive:
          "border-[var(--alert-error-border)] bg-[var(--alert-error-bg)] text-[var(--alert-error-fg)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? "default"}
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-bold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "group-data-[variant=default]/alert:text-muted-foreground text-pretty group-has-[>svg]/alert:col-start-2 [&_a]:font-semibold [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-3",
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-1/2 right-3 -translate-y-1/2", className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
