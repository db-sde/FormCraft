"use client";

import { useState } from "react";
import { Check, Copy, RefreshCw, Trash2 } from "lucide-react";
import type { ThemeV1, ThemeVariantV1 } from "@/domains/forms/schema/v1";
import { saveLookAsVariant } from "@/domains/themes/variants";
import { themeFontStack } from "@/components/theme-styles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PANEL_INPUT, PanelNote, SectionHead } from "./panel-ui";

const MAX_LINK_THEMES = 10;

/**
 * Link themes (F-66) in the Design panel: the current look saved under a
 * name, which a link then picks with ?theme=<id> (or the embed code's
 * Theme choice). Links with anything else get the form's main look.
 */
export function LinkThemes({
  theme,
  variants,
  formUrl,
  onChange,
}: {
  theme: ThemeV1;
  variants: ThemeVariantV1[];
  /** The form's public link, for "Copy link". */
  formUrl: string;
  onChange: (variants: ThemeVariantV1[]) => void;
}) {
  const [name, setName] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const full = variants.length >= MAX_LINK_THEMES;

  function save() {
    if (!name.trim() || full) return;
    onChange([...variants, saveLookAsVariant(theme, name, variants)]);
    setName("");
  }

  return (
    <>
      <SectionHead>Link themes</SectionHead>
      <PanelNote>
        Save the look above under a name, then add <code>?theme=</code> and its link name
        to the form&apos;s link, or choose it in the embed code. Any other link shows the
        main look. Changes go live when you publish.
      </PanelNote>
      {variants.length > 0 && (
        <ul aria-label="Link themes" className="col-span-full flex flex-col gap-1.5">
          {variants.map((variant) => {
            const link = `${formUrl}?theme=${variant.id}`;
            return (
              <li
                key={variant.id}
                className="border-border flex items-center gap-2 rounded-[8px] border-[1.5px] p-1.5"
              >
                <span
                  aria-hidden
                  className="flex h-8 w-10 shrink-0 items-center justify-center rounded-[5px] border"
                  style={{ background: variant.theme.backgroundColor }}
                >
                  <span
                    className="h-2.5 w-5 rounded-[2px]"
                    style={{ background: variant.theme.primaryColor }}
                  />
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <b
                    className="truncate text-[13px]"
                    style={{ fontFamily: themeFontStack(variant.theme) }}
                  >
                    {variant.name}
                  </b>
                  <span className="text-muted-foreground truncate font-mono text-[11.5px]">
                    ?theme={variant.id}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Copy the link for ${variant.name}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(link).then(() => {
                      setCopied(variant.id);
                      setTimeout(() => setCopied(null), 1500);
                    });
                  }}
                >
                  {copied === variant.id ? <Check /> : <Copy />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Update ${variant.name} to the look above`}
                  title="Update to the look above"
                  onClick={() =>
                    onChange(
                      variants.map((v) =>
                        v.id === variant.id
                          ? { ...saveLookAsVariant(theme, v.name, []), id: v.id }
                          : v,
                      ),
                    )
                  }
                >
                  <RefreshCw />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  aria-label={`Remove ${variant.name}`}
                  onClick={() => onChange(variants.filter((v) => v.id !== variant.id))}
                >
                  <Trash2 />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="col-span-full flex gap-2">
        <Input
          className={PANEL_INPUT}
          value={name}
          maxLength={60}
          placeholder={full ? "Ten link themes at most" : "Name, like Dark"}
          aria-label="Link theme name"
          disabled={full}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-[38px] shrink-0"
          disabled={!name.trim() || full}
          onClick={save}
        >
          Save this look
        </Button>
      </div>
    </>
  );
}
