"use client";

import * as React from "react";
import { cn } from "cn";
import { Switch as SwitchPrimitive } from "radix-ui";

/** On: ink track, marigold thumb. Off: muted track with a quiet border. */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default";
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch focus-visible:shadow-focus data-checked:border-secondary data-checked:bg-secondary data-unchecked:border-input data-unchecked:bg-muted relative inline-flex shrink-0 items-center rounded-full border-[1.5px] transition-colors outline-none after:absolute after:-inset-x-3 after:-inset-y-2 data-disabled:cursor-not-allowed data-disabled:opacity-45 data-[size=default]:h-[22px] data-[size=default]:w-10 data-[size=sm]:h-5 data-[size=sm]:w-9",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="data-checked:bg-primary data-unchecked:border-input data-unchecked:bg-card pointer-events-none block rounded-full transition-transform group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3.5 group-data-[size=default]/switch:data-checked:translate-x-[19px] group-data-[size=sm]/switch:data-checked:translate-x-[17px] data-unchecked:translate-x-[1px] data-unchecked:border-[1.5px]"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
