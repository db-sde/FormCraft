import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/** Small pills (counts, tags). Statuses use StatusChip instead. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border-[1.5px] border-transparent px-2 text-[11px] font-bold whitespace-nowrap transition-colors focus-visible:shadow-focus [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "border-ink bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive:
          "border-ink bg-[var(--chip-failed-bg)] text-[var(--chip-failed-fg)] uppercase tracking-[0.05em]",
        success:
          "border-ink bg-[var(--chip-live-bg)] text-[var(--chip-live-fg)] uppercase tracking-[0.05em]",
        pending:
          "border-ink bg-[var(--chip-pending-bg)] text-[var(--chip-pending-fg)] uppercase tracking-[0.05em]",
        outline: "border-input bg-card text-muted-foreground",
        ghost: "bg-hover-wash text-foreground",
        link: "text-foreground underline underline-offset-4",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
