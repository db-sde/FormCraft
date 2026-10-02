"use client";

import { useState, useTransition } from "react";
import { Check, Contrast } from "lucide-react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { THEME_PRESETS, contrastRatio } from "@/domains/themes";
import { THEME_FONT_STACK } from "@/components/theme-styles";
import { FONT_LABEL, isPaidFont } from "@/domains/themes/fonts";
import { uploadThemeFontAction } from "@/app/(form)/forms/[id]/actions";
import { stageTextColor } from "@/components/runtime/stage-theme";
import { ColorField } from "./color-field";
import { ImageUploadField } from "./image-upload-field";
import { PanelField, SectionHead, Segmented } from "./panel-ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "cn";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** WCAG AA for body text. */
const READABLE = 4.5;
const PRESET_RADIUS = { rounded: "4px", square: "0", pill: "999px" } as const;

/** The Design panel (Part 4): presets, colours, type & shape, images. */
export function ThemeSettingsPanel({
  theme,
  workspaceId,
  formId,
  onChange,
  customFonts = true,
}: {
  /** The plan includes paid and uploaded fonts (P2.22). */
  customFonts?: boolean;
  theme: ThemeV1;
  workspaceId: string;
  formId: string;
  onChange: (next: ThemeV1) => void;
}) {
  const set = (patch: Partial<ThemeV1>) =>
    onChange({ ...theme, ...patch, preset: undefined });

  const text = stageTextColor(theme);
  const ratio =
    HEX_RE.test(theme.backgroundColor) && HEX_RE.test(text)
      ? contrastRatio(text, theme.backgroundColor)
      : READABLE;
  const autoText = stageTextColor({ ...theme, textColor: undefined });

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <div className="col-span-full flex flex-col gap-1.5">
        <span className="text-[13.5px] font-semibold">Presets</span>
        <div className="grid grid-cols-2 gap-2">
          {THEME_PRESETS.map((preset) => {
            const on = theme.preset === preset.id;
            const p = preset.theme;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...theme, ...p, preset: preset.id })}
                className={cn(
                  "fc-focus bg-card flex flex-col gap-1.5 rounded-[8px] border-[1.5px] p-1.5 text-left",
                  on ? "border-ink shadow-card" : "border-border hover:border-input",
                )}
              >
                <span
                  aria-hidden
                  className="flex h-[52px] flex-col justify-center gap-[5px] rounded-[5px] px-2.5"
                  style={{ background: p.backgroundColor }}
                >
                  <span
                    className="h-1.5 w-[70%] rounded-[2px]"
                    style={{ background: p.textColor ?? stageTextColor(p) }}
                  />
                  <span
                    className="h-3 w-[34px]"
                    style={{
                      background: p.primaryColor,
                      borderRadius: PRESET_RADIUS[p.buttonStyle],
                    }}
                  />
                </span>
                <span
                  className="flex items-center justify-between text-[13px] font-semibold"
                  style={{ fontFamily: THEME_FONT_STACK[p.fontFamily] }}
                >
                  {preset.name}
                  {on && <Check className="size-[13px]" />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <SectionHead>Colours</SectionHead>
      <ColorField
        label="Primary"
        value={theme.primaryColor}
        hint="Buttons, selected choices, progress and stars"
        onChange={(primaryColor) => set({ primaryColor })}
      />
      <ColorField
        label="Background"
        value={theme.backgroundColor}
        onChange={(backgroundColor) => set({ backgroundColor })}
      />
      <ColorField
        label="Text"
        optional
        value={theme.textColor ?? ""}
        placeholder={autoText}
        hint={theme.textColor ? undefined : "Empty = worked out from the background"}
        onChange={(textColor) => set({ textColor: textColor || undefined })}
      />
      {ratio < READABLE && (
        <div
          role="status"
          className="border-warning col-span-full flex gap-2.5 rounded-sm border-[1.5px] bg-[var(--chip-draft-bg)] px-3 py-[11px] text-[13px] leading-[1.45] text-[var(--chip-draft-fg)]"
        >
          <Contrast className="mt-px size-[17px] shrink-0" />
          <span className="flex flex-col gap-1.5">
            <span>
              <b>Low contrast · {ratio.toFixed(1)}:1</b> Text may be hard to read on this
              background. Aim for at least 4.5:1.
            </span>
            <button
              type="button"
              onClick={() => set({ textColor: autoText })}
              className="fc-focus h-7 self-start rounded-[5px] border-[1.5px] border-current px-2.5 text-[12.5px] font-bold"
            >
              Pick a readable text colour
            </button>
          </span>
        </div>
      )}

      <SectionHead>Type &amp; shape</SectionHead>
      <PanelField
        label="Font"
        hint={customFonts ? undefined : "Fonts marked “Paid” need a paid plan."}
      >
        <Select
          value={theme.fontFamily}
          onValueChange={(fontFamily) =>
            set({ fontFamily: fontFamily as ThemeV1["fontFamily"] })
          }
        >
          <SelectTrigger className="h-[38px] w-full" aria-label="Font">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(FONT_LABEL) as ThemeV1["fontFamily"][]).map((font) => (
              <SelectItem
                key={font}
                value={font}
                disabled={!customFonts && isPaidFont(font)}
                style={{ fontFamily: THEME_FONT_STACK[font] }}
              >
                {FONT_LABEL[font]}
                {!customFonts && isPaidFont(font) && (
                  <span className="text-muted-foreground ml-1 text-xs">Paid</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PanelField>
      {theme.fontFamily === "custom" && customFonts && (
        <FontUpload
          formId={formId}
          current={theme.customFont}
          onUploaded={(customFont) => set({ fontFamily: "custom", customFont })}
        />
      )}
      <Segmented
        label="Button style"
        value={theme.buttonStyle}
        options={[
          { value: "rounded", label: "Rounded" },
          { value: "square", label: "Square" },
          { value: "pill", label: "Pill" },
        ]}
        onChange={(buttonStyle) => set({ buttonStyle })}
      />

      <SectionHead>Images</SectionHead>
      <ImageUploadField
        label="Logo"
        noun="a logo"
        meta="Top left, 32px tall"
        workspaceId={workspaceId}
        formId={formId}
        value={theme.logoUrl}
        onChange={(logoUrl) => onChange({ ...theme, logoUrl })}
      />
      <ImageUploadField
        label="Background image"
        noun="an image"
        meta="Cover · a 72% scrim keeps text readable"
        workspaceId={workspaceId}
        formId={formId}
        value={theme.backgroundImageUrl}
        onChange={(backgroundImageUrl) => onChange({ ...theme, backgroundImageUrl })}
      />
    </div>
  );
}

/** Upload a licensed WOFF2 font (P2.22); checked again on the server. */
function FontUpload({
  formId,
  current,
  onUploaded,
}: {
  formId: string;
  current: ThemeV1["customFont"];
  onUploaded: (font: NonNullable<ThemeV1["customFont"]>) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="col-span-full flex flex-col gap-2 rounded-[8px] border-[1.5px] border-dashed p-3"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        setError(null);
        start(async () => {
          const result = await uploadThemeFontAction(formId, data);
          if (result.ok) onUploaded({ name: result.name, url: result.url });
          else setError(result.message);
        });
      }}
    >
      {current && (
        <p className="text-[13px]">
          Using <b>{current.name}</b>. Upload another to replace it.
        </p>
      )}
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        Font name
        <input
          name="name"
          required
          maxLength={60}
          defaultValue={current?.name}
          className="border-input bg-field h-[34px] rounded-sm border-[1.5px] px-2 font-normal"
        />
      </label>
      <label className="flex flex-col gap-1 text-[13px] font-semibold">
        WOFF2 file, up to 2 MB
        <input
          name="file"
          type="file"
          accept=".woff2,font/woff2"
          required
          className="text-xs"
        />
      </label>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input name="licensed" type="checkbox" value="yes" required className="mt-0.5" />
        I&apos;m licensed to use this font on the web.
      </label>
      {error && (
        <p role="alert" className="text-destructive text-[12.5px]">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="fc-focus border-ink self-start rounded-sm border-[1.5px] px-3 py-1 text-[13px] font-semibold"
      >
        {pending ? "Uploading…" : "Upload font"}
      </button>
    </form>
  );
}
