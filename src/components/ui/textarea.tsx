import * as React from "react";
import { cn } from "cn";
import { inputBase } from "./input";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        inputBase,
        "flex field-sizing-content min-h-20 py-2.5 leading-normal",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
