"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import { Check, Copy, ExternalLink, Share2, X } from "lucide-react";
import { toast } from "sonner";
import { buildEmbedSnippet } from "@/domains/forms/embed";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { publicFormUrl } from "./live-link-actions";
import { CopyLinkField } from "./copy-link-field";
import { cn } from "cn";

type Tab = "link" | "qr" | "embed";
type EmbedMode = "standard" | "full";

/** Header "Share" (Part 4): the live link, a QR code and embed code.
 * Only offered while the form is live. */
export function SharePopover({
  formId,
  slug,
  title,
  description,
  primaryColor,
}: {
  formId: string;
  slug: string;
  title: string;
  description?: string;
  /** The form theme's primary colour, for the link-preview card. */
  primaryColor: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("link");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("h-9 px-3", open && "bg-accent")}>
          <Share2 /> <span className="max-xl:sr-only">Share</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={10}
        className="shadow-lift w-[440px] max-w-[calc(100vw-32px)] overflow-hidden rounded-lg p-0"
      >
        <div className="flex items-center justify-between px-4 pt-3.5">
          <b className="font-heading text-[17px]">Share your form</b>
          <PopoverClose
            aria-label="Close"
            className="fc-focus hover:bg-hover-wash grid size-[30px] place-items-center rounded-sm"
          >
            <X className="size-4" />
          </PopoverClose>
        </div>
        <div
          role="tablist"
          className="border-border flex gap-5 border-b-[1.5px] px-4 pt-2.5"
        >
          {(
            [
              ["link", "Link"],
              ["qr", "QR code"],
              ["embed", "Embed"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "fc-focus py-2 text-sm",
                tab === id
                  ? "font-bold shadow-[inset_0_-3px_0_var(--primary)]"
                  : "font-medium",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-3.5 p-4">
          {tab === "link" && (
            <LinkTab
              slug={slug}
              title={title}
              description={description}
              primaryColor={primaryColor}
            />
          )}
          {tab === "qr" && <ShareQr slug={slug} />}
          {tab === "embed" && <ShareEmbed slug={slug} formId={formId} title={title} />}
          <Link
            href={`/forms/${formId}/share`}
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground self-start text-[13px] underline underline-offset-2"
          >
            More ways to share
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function useCopy(): [boolean, (text: string) => Promise<boolean>] {
  const [copied, setCopied] = useState(false);
  return [
    copied,
    async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
        return true;
      } catch {
        toast.error("Couldn't copy.", {
          description: "Select the text and copy it yourself.",
        });
        return false;
      }
    },
  ];
}

function LinkTab({
  slug,
  title,
  description,
  primaryColor,
}: {
  slug: string;
  title: string;
  description?: string;
  primaryColor: string;
}) {
  return (
    <>
      <CopyLinkField slug={slug} />
      <a
        href={`/f/${slug}`}
        target="_blank"
        rel="noreferrer"
        className="decoration-primary flex items-center gap-1.5 self-start text-[13.5px] font-semibold underline decoration-2 underline-offset-2"
      >
        <ExternalLink className="size-3.5" /> Open live form
      </a>
      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs font-bold tracking-[0.08em] uppercase">
          Link preview in chat apps
        </span>
        <div className="border-border bg-field flex overflow-hidden rounded-[8px] border-[1.5px]">
          <span className="w-1 shrink-0" style={{ background: primaryColor }} />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px] px-3 py-2.5 text-[13px]">
            <b className="truncate">{title}</b>
            {description && (
              <span className="text-muted-foreground line-clamp-2">{description}</span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

/** The live link as a QR code, with PNG and SVG downloads. */
export function ShareQr({ slug }: { slug: string }) {
  const url = publicFormUrl(slug);
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void QRCode.toString(url, {
      type: "svg",
      margin: 1,
      color: { dark: "#2b2118", light: "#ffffff" },
    }).then((s) => !cancelled && setSvg(s));
    return () => {
      cancelled = true;
    };
  }, [url]);

  function download(href: string, ext: "png" | "svg") {
    const a = document.createElement("a");
    a.href = href;
    a.download = `${slug}-qr.${ext}`;
    a.click();
  }

  return (
    <div className="flex items-center gap-4">
      <div
        aria-label={`QR code for ${url}`}
        role="img"
        className="border-ink size-[170px] shrink-0 overflow-hidden rounded-[8px] border-[1.5px] bg-white p-1.5 [&_svg]:size-full"
        // The SVG is generated locally from our own URL by the qrcode library.
        dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
      />
      <div className="text-muted-foreground flex flex-col gap-2.5 text-[13.5px] leading-[1.45]">
        <span>Put it on posters, slides or a table tent. It opens the live form.</span>
        <Button
          size="sm"
          className="h-9 self-start"
          onClick={async () =>
            download(
              await QRCode.toDataURL(url, {
                width: 1024,
                margin: 2,
                color: { dark: "#2b2118", light: "#ffffff" },
              }),
              "png",
            )
          }
        >
          Download PNG
        </Button>
        <button
          type="button"
          disabled={!svg}
          onClick={() =>
            svg &&
            download(
              URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
              "svg",
            )
          }
          className="text-foreground self-start underline underline-offset-2"
        >
          Download SVG
        </button>
      </div>
    </div>
  );
}

/** Embed code: the standard auto-resizing iframe, or full page. */
export function ShareEmbed({
  slug,
  formId,
  title,
}: {
  slug: string;
  formId: string;
  title: string;
}) {
  const [mode, setMode] = useState<EmbedMode>("standard");
  const [copied, copy] = useCopy();
  const url = publicFormUrl(slug);
  const code =
    mode === "standard"
      ? buildEmbedSnippet({ formUrl: url, formId, title })
      : `<iframe src="${url}?embed=1" title="${title.replace(/"/g, "&quot;")}" style="position:fixed;inset:0;width:100%;height:100%;border:0"></iframe>`;

  return (
    <>
      <div className="border-border bg-background flex gap-0.5 self-start rounded-[8px] border-[1.5px] p-[3px]">
        {(
          [
            ["standard", "Standard"],
            ["full", "Full page"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={cn(
              "fc-focus rounded-[5px] px-3 py-[5px] text-[13px] font-semibold",
              mode === id
                ? "bg-secondary text-secondary-foreground"
                : "hover:bg-hover-wash",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <pre className="max-h-48 overflow-auto rounded-sm bg-[#2b2118] p-3 font-mono text-xs leading-[1.55] break-all whitespace-pre-wrap text-[#f3ebdf]">
        {code}
      </pre>
      <Button
        variant="outline"
        size="sm"
        className="h-9 self-start"
        onClick={() => void copy(code)}
      >
        {copied ? <Check /> : <Copy />}
        {copied ? "Copied" : "Copy code"}
      </Button>
    </>
  );
}
