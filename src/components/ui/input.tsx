import * as React from "react";
import { cn } from "cn";

/** Text input (Part 1 §3): 42px, quiet 1.5px border at rest, ink when
 * focused (with the focus ring), red when invalid, dashed when disabled. */
const inputBase =
  "w-full min-w-0 rounded-sm border-[1.5px] border-input bg-field px-3 text-[14.5px] text-foreground transition-[border-color,box-shadow] outline-none placeholder:text-subtle-foreground focus-visible:border-ink focus-visible:shadow-focus disabled:cursor-not-allowed disabled:border-dashed disabled:border-disabled-border disabled:bg-disabled disabled:text-subtle-foreground aria-invalid:border-destructive";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        inputBase,
        "h-[42px] file:mr-3 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-semibold",
        className,
      )}
      {...props}
    />
  );
}

export { Input, inputBase };
