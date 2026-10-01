import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/**
 * Buttons from the design system (Part 1 §3): 1.5px border, radius 6,
 * 14.5px/700. Primary and Destructive sit on a hard 2/2/0 ink shadow,
 * lift 1px on hover (shadow 3/3/0) and press flat into it.
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-sm border-[1.5px] border-transparent font-bold whitespace-nowrap transition-[transform,box-shadow,background-color,color] duration-[80ms] outline-none select-none focus-visible:shadow-focus disabled:pointer-events-none [&:disabled:not([data-loading=true])]:border-disabled-border [&:disabled:not([data-loading=true])]:bg-disabled [&:disabled:not([data-loading=true])]:text-disabled-foreground [&:disabled:not([data-loading=true])]:shadow-none data-[loading=true]:cursor-progress aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&_svg]:stroke-[1.75]",
  {
    variants: {
      variant: {
        default:
          "border-ink bg-primary text-primary-foreground shadow-raised hover:-translate-x-px hover:-translate-y-px hover:shadow-raised-hover focus-visible:shadow-[2px_2px_0_var(--shadow-ink),0_0_0_2px_var(--card),0_0_0_4px_var(--ring)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        secondary:
          "border-secondary bg-secondary text-secondary-foreground hover:border-secondary-hover hover:bg-secondary-hover",
        outline:
          "border-ink bg-card text-foreground hover:bg-accent active:bg-accent-pressed aria-expanded:bg-accent",
        ghost:
          "text-foreground hover:bg-hover-wash active:bg-hover-wash-strong aria-expanded:bg-hover-wash",
        destructive:
          "border-ink bg-destructive text-destructive-foreground shadow-raised hover:-translate-x-px hover:-translate-y-px hover:shadow-raised-hover focus-visible:shadow-[2px_2px_0_var(--shadow-ink),0_0_0_2px_var(--card),0_0_0_4px_var(--ring)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none",
        link: "h-auto! px-0! text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:text-black disabled:bg-transparent! disabled:border-transparent! disabled:no-underline dark:hover:text-white",
      },
      size: {
        default: "h-10 px-4 text-[14.5px]",
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 px-[22px] text-base",
        auth: "h-[46px] px-4 text-[14.5px]",
        icon: "size-10",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-4",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

/** The 14px loading spinner that goes before a button's "…ing" label. */
function ButtonSpinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

export { Button, ButtonSpinner, buttonVariants };
