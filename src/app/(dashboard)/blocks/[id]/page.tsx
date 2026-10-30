import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { canEdit } from "@/domains/workspaces";
import {
  blockUsage,
  getBlock,
  getBlockVersion,
  listBlockVersions,
} from "@/domains/blocks/queries";
import { BlockEditor } from "@/components/blocks/block-editor";
import { BlockHistory } from "@/components/blocks/block-history";

export const metadata: Metadata = { title: "Question block" };

export default async function BlockPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const { supabase, workspace } = await getCurrentWorkspace();
  const block = await getBlock(supabase, workspace.id, id);
  if (!block) notFound();
  const [questions, versions, usage] = await Promise.all([
    getBlockVersion(supabase, id, block.current_version),
    listBlockVersions(supabase, id),
    blockUsage(supabase, workspace.id, id),
  ]);
  if (!questions) notFound();
  const editable = canEdit(workspace.role) && !block.archived_at;

  return (
    <div className="flex flex-col gap-[22px]">
      <Link
        href="/blocks"
        className="fc-focus text-muted-foreground hover:text-foreground flex w-fit items-center gap-1.5 rounded-xs text-sm font-semibold"
      >
        <ArrowLeft className="size-4" />
        All blocks
      </Link>
      <h1 className="font-heading text-[34px] leading-none font-bold tracking-[-0.03em]">
        {block.name}
        {block.archived_at && (
          <span className="text-muted-foreground ml-3 text-base font-semibold">
            Archived
          </span>
        )}
      </h1>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <BlockEditor
          key={block.current_version}
          blockId={id}
          workspaceId={workspace.id}
          initial={{
            name: block.name,
            description: block.description,
            version: block.current_version,
            questions,
          }}
          canEdit={editable}
        />
        <BlockHistory
          blockId={id}
          currentVersion={block.current_version}
          versions={versions}
          usage={usage}
          canEdit={editable}
        />
      </div>
    </div>
  );
}
