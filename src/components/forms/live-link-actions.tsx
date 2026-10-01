"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function publicFormUrl(slug: string): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    (typeof window !== "undefined" ? window.location.origin : "");
  return `${base}/f/${slug}`;
}

/** Copies a form's public link, with brief "copied" feedback. */
export function CopyLinkButton({
  slug,
  label,
  variant = "ghost",
}: {
  slug: string;
  /** Show text next to the icon (otherwise icon-only with a tooltip). */
  label?: string;
  variant?: "ghost" | "outline" | "default";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = publicFormUrl(slug);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success("Link copied", { description: url });
    } catch {
      toast.error("Couldn't copy the link", { description: url });
    }
  }

  const icon = copied ? <Check /> : <Copy />;
  if (label) {
    return (
      <Button type="button" variant={variant} onClick={copy}>
        {icon}
        {copied ? "Copied" : label}
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={variant}
          size="icon"
          aria-label="Copy link"
          onClick={copy}
        >
          {icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy link</TooltipContent>
    </Tooltip>
  );
}

/** Opens the live form in a new tab. */
export function OpenLiveButton({ slug, label }: { slug: string; label?: string }) {
  if (label) {
    return (
      <Button asChild variant="outline">
        <a href={`/f/${slug}`} target="_blank" rel="noreferrer">
          <ExternalLink />
          {label}
        </a>
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button asChild variant="ghost" size="icon">
          <a
            href={`/f/${slug}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open live form"
          >
            <ExternalLink />
          </a>
        </Button>
      </TooltipTrigger>
      <TooltipContent>Open live form</TooltipContent>
    </Tooltip>
  );
}

/** Copies arbitrary text (e.g. an embed snippet). */
export function CopyTextButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Couldn't copy — select the text and copy it manually.");
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}
