"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  archiveBlockAction,
  restoreBlockVersionAction,
} from "@/app/(dashboard)/blocks/actions";
import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";

/** A block's versions (restoring one publishes a copy of it as the
 * newest — rollback without rewriting history), the forms that use it,
 * and archiving. */
export function BlockHistory({
  blockId,
  currentVersion,
  versions,
  usage,
  canEdit,
}: {
  blockId: string;
  currentVersion: number;
  versions: {
    version: number;
    createdAt: string;
    questionCount: number;
    by: string | null;
  }[];
  usage: { formId: string; title: string; versions: number[] }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Used in</h2>
        {usage.length === 0 ? (
          <p className="text-muted-foreground text-sm">No form uses it yet.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm" data-testid="block-usage">
            {usage.map((u) => (
              <li key={u.formId}>
                <Link
                  href={`/forms/${u.formId}`}
                  className="font-semibold underline underline-offset-2"
                >
                  {u.title}
                </Link>{" "}
                <span className="text-muted-foreground">
                  version {u.versions.join(", ")}
                  {u.versions.every((v) => v < currentVersion) && " · update available"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-heading text-lg font-bold">Versions</h2>
        <ol className="flex flex-col gap-1.5 text-sm">
          {versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center gap-2">
              <b>Version {v.version}</b>
              <span className="text-muted-foreground">
                <LocalTime iso={v.createdAt} /> · {v.questionCount} question
                {v.questionCount === 1 ? "" : "s"}
                {v.by ? ` · ${v.by}` : ""}
              </span>
              {v.version === currentVersion ? (
                <span className="text-xs font-semibold">Current</span>
              ) : (
                canEdit && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const result = await restoreBlockVersionAction(
                          blockId,
                          v.version,
                        );
                        if (result.ok) {
                          toast.success(`Restored as version ${result.version}.`);
                          router.refresh();
                        } else toast.error(result.message);
                      })
                    }
                  >
                    Restore
                  </Button>
                )
              )}
            </li>
          ))}
        </ol>
      </section>
      {canEdit && (
        <section>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await archiveBlockAction(blockId);
                if (result.ok) {
                  toast.success("Block archived.", {
                    description: "Forms keep their copies and can detach them.",
                  });
                  router.push("/blocks");
                } else toast.error(result.message);
              })
            }
          >
            Archive block
          </Button>
        </section>
      )}
    </div>
  );
}
