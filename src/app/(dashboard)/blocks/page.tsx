import type { Metadata } from "next";
import Link from "next/link";
import { Library } from "lucide-react";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { listBlocks } from "@/domains/blocks/queries";
import { EmptyState } from "@/components/shared/empty-state";
import { LocalTime } from "@/components/local-time";

export const metadata: Metadata = { title: "Question blocks" };

/** The workspace's library of shared question blocks (master spec F-09). */
export default async function BlocksPage() {
  const { supabase, workspace } = await getCurrentWorkspace();
  const blocks = await listBlocks(supabase, workspace.id);

  return (
    <div className="flex flex-col gap-[22px]">
      <div>
        <h1 className="font-heading text-[38px] leading-none font-bold tracking-[-0.03em] sm:text-[56px] sm:tracking-[-0.035em]">
          Question blocks
        </h1>
        <p className="text-muted-foreground mt-2.5 max-w-2xl text-[15px]">
          Questions your team reuses across forms — a consent step, an address, a
          screening set. Edit a block once and each form using it is offered the update.
        </p>
      </div>
      {blocks.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No blocks yet"
          description="In the form builder, select a question and choose “Save to block library”."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="block-list">
          {blocks.map((block) => (
            <li key={block.id}>
              <Link
                href={`/blocks/${block.id}`}
                className="border-ink bg-card hover:bg-accent fc-focus flex h-full flex-col gap-1.5 rounded-lg border-[1.5px] p-4"
              >
                <b className="font-heading text-lg">{block.name}</b>
                {block.description && (
                  <span className="text-muted-foreground line-clamp-2 text-sm">
                    {block.description}
                  </span>
                )}
                <span className="text-muted-foreground mt-auto text-xs">
                  Version {block.currentVersion} · updated{" "}
                  <LocalTime iso={block.updatedAt} variant="relative" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
