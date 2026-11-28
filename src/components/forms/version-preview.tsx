"use client";

import { FormCustomCss, FormRenderer } from "@/components/runtime/form-renderer";
import type { CompiledFormV1 } from "@/domains/forms/schema/compile";

/** An earlier version, to try as respondents saw it (QA FC15-24). Like the
 * builder's Preview: nothing is saved or sent. */
export function VersionPreview({ compiled }: { compiled: CompiledFormV1 }) {
  return (
    <div className="fc-custom-scope border-ink shadow-lift h-[640px] overflow-hidden rounded-lg border-[1.5px] bg-white">
      <FormCustomCss css={compiled.schema.theme.customCss} />
      <FormRenderer
        compiled={compiled}
        brandingRemovable
        redirectOnEnding={false}
        mode="desktop"
        className="h-full"
      />
    </div>
  );
}
