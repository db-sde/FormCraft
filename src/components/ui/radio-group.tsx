"use client";

import * as React from "react";
import { cn } from "cn";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn("grid w-full gap-2", className)}
      {...props}
    />
  );
}

/** Selected: marigold dot inside a thick ink ring. */
function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        "group/radio-group-item peer border-ink bg-field focus-visible:shadow-focus disabled:border-disabled-border disabled:bg-disabled aria-invalid:border-destructive data-checked:border-secondary data-checked:bg-primary relative flex aspect-square size-[18px] shrink-0 rounded-full border-[1.5px] outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed data-checked:border-[5px]",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator data-slot="radio-group-indicator" />
    </RadioGroupPrimitive.Item>
  );
}

export { RadioGroup, RadioGroupItem };
