import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { compileFormSchema, parseFormSchema } from "@/domains/forms/schema";
import { listVersions } from "@/domains/forms/versions/history";
import { VersionPreview } from "@/components/forms/version-preview";
import { loadFormForPage } from "../../../../load-form";

export const metadata: Metadata = { title: "Version" };

/** One published version, read-only, as respondents saw it (QA FC15-24). */
export default async function VersionPage({
  params,
}: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const { id: formId, versionId } = await params;
  const { supabase } = await loadFormForPage(formId);
  const { data: version } = await supabase
    .from("form_versions")
    .select("id, schema, status")
    .eq("id", versionId)
    .eq("form_id", formId)
    .in("status", ["published", "archived"])
    .maybeSingle();
  if (!version) notFound();
  const versions = await listVersions(supabase, formId);
  const index = versions.findIndex((v) => v.id === versionId);
  const number = index === -1 ? null : versions.length - index;
  const compiled = compileFormSchema(parseFormSchema(version.schema));

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-4 px-4 py-6">
      <Link
        href={`/forms/${formId}/settings`}
        className="fc-focus text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 text-sm font-semibold"
      >
        <ArrowLeft className="size-4" /> Back to settings
      </Link>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-heading text-2xl font-bold">
          {number ? `Version ${number}` : "Version"}
          {version.status === "published" ? " (live)" : ""}
        </h1>
        <span className="text-muted-foreground text-sm">
          Read-only: try it as respondents saw it. Nothing is saved.
        </span>
      </div>
      <VersionPreview compiled={compiled} />
    </div>
  );
}
