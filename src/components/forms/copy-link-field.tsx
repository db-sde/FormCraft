"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { publicFormUrl } from "./live-link-actions";
import { cn } from "cn";

/** The live link in a mono box with a Copy button joined to it. */
export function CopyLinkField({ slug, className }: { slug: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const url = publicFormUrl(slug);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("Couldn't copy.", {
        description: "Select the link and copy it yourself.",
      });
    }
  }

  return (
    <div
      className={cn(
        "border-ink bg-field flex h-[42px] w-full items-center overflow-hidden rounded-sm border-[1.5px]",
        className,
      )}
    >
      <span className="min-w-0 flex-1 truncate px-3 text-left font-mono text-[13px]">
        {url.replace(/^https?:\/\//, "")}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(
          "fc-focus border-ink flex h-full shrink-0 items-center gap-1.5 border-l-[1.5px] px-3.5 text-[13px] font-bold",
          copied
            ? "bg-[var(--chip-live-bg)] text-[var(--chip-live-fg)]"
            : "bg-primary text-primary-foreground",
        )}
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
