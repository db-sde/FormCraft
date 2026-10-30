"use client";

import { scopedCustomCss } from "@/domains/themes/custom-css";
import { ClassicFormRuntime } from "./classic-runtime";
import { FormRuntime, type FormRuntimeProps } from "./form-runtime";

/**
 * The respondent experience in the layout the form asks for (F-01): one
 * question at a time (the default) or classic pages. Both take the same
 * props and share the engine, so the public form and the builder's
 * Preview pick the layout in one place.
 */
export function FormRenderer(props: FormRuntimeProps) {
  return props.compiled.schema.meta.layout === "classic" ? (
    <ClassicFormRuntime {...props} />
  ) : (
    <FormRuntime {...props} />
  );
}

/**
 * The form's custom CSS (F-14), nested inside the form's scope so it can't
 * reach the rest of the page. Renders nothing when there's none, or when
 * it fails the checks the schema also makes.
 */
export function FormCustomCss({ css }: { css: string | undefined }) {
  const sheet = scopedCustomCss(css);
  return sheet ? <style data-fc-custom-css>{sheet}</style> : null;
}
