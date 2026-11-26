"use client";

import { useState, useTransition } from "react";
import { Contrast } from "lucide-react";
import type { ThemeV1, ThemeVariantV1 } from "@/domains/forms/schema/v1";
import { contrastRatio } from "@/domains/themes";
import { scriptForLanguage } from "@/domains/themes/font-metadata";
import { THEME_FONT_STACK } from "@/components/theme-styles";
import { FontLibraryPicker } from "./font-library-picker";
import { ThemeGallery } from "./theme-gallery";
import { FONT_LABEL, isPaidFont } from "@/domains/themes/fonts";
import { uploadThemeFontAction } from "@/app/(form)/forms/[id]/actions";
import { stageTextColor } from "@/components/runtime/stage-theme";
import { ColorField } from "./color-field";
import { ImageUploadField } from "./image-upload-field";
import { PanelField, PanelNote, SectionHead, Segmented } from "./panel-ui";
import { CustomCssEditor } from "./custom-css-editor";
import { LinkThemes } from "./link-themes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
/** WCAG AA for body text. */
const READABLE = 4.5;

/** The Design panel (Part 4): presets, colours, type & shape, images. */
export function ThemeSettingsPanel({
  theme,
  workspaceId,
  formId,
  onChange,
  customFonts = true,
  formTitle = "",
  languages = [],
  layout = "conversational",
  onLayoutChange,
  autoAdvance,
  onAutoAdvanceChange,
  reviewStep,
  onReviewStepChange,
  linkThemes,
}: {
  /** Saved looks a link can pick with ?theme= (F-66). */
  linkThemes?: {
    variants: ThemeVariantV1[];
    formUrl: string;
    onChange: (variants: ThemeVariantV1[]) => void;
  };
  /** One question per screen, or classic pages (F-01). */
  layout?: "conversational" | "classic";
  onLayoutChange?: (layout: "conversational" | "classic") => void;
  /** The form's auto-advance (F-63): on unless false. */
  autoAdvance?: boolean;
  onAutoAdvanceChange?: (on: boolean) => void;
  /** A review of the answers before submitting (F-60). */
  reviewStep?: boolean;
  onReviewStepChange?: (on: boolean) => void;
  /** For the theme and font previews. */
  formTitle?: string;
  /** The form's languages: fonts are offered only if they can show them. */
  languages?: string[];
  /** The plan includes paid and uploaded fonts (P2.22). */
  customFonts?: boolean;
  theme: ThemeV1;
  workspaceId: string;
  formId: string;
  /** A new theme, or a change to apply to the latest one — uploads
   * finish later, and two at once mustn't overwrite each other. */
  onChange: (next: ThemeV1 | ((current: ThemeV1) => ThemeV1)) => void;
}) {
  // Fonts offered must show every language the form is in.
  const scripts = [...new Set(languages.map(scriptForLanguage))];
  const set = (patch: Partial<ThemeV1>) =>
    onChange((current) => ({ ...current, ...patch, preset: undefined }));

  const text = stageTextColor(theme);
  const ratio =
    HEX_RE.test(theme.backgroundColor) && HEX_RE.test(text)
      ? contrastRatio(text, theme.backgroundColor)
      : READABLE;
  const autoText = stageTextColor({ ...theme, textColor: undefined });

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <ThemeGallery
        theme={theme}
        formTitle={formTitle}
        canSave
        onApply={(next) => onChange(next)}
      />

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
        hint={
          customFonts
            ? "Font library: 1,900+ open-licensed fonts, served from FormCraft."
            : "Uploading your own font starts on the Starter plan."
        }
      >
        <Select
          value={theme.fontFamily}
          onValueChange={(fontFamily) =>
            set(
              fontFamily === "library"
                ? { fontFamily: "library", libraryFont: theme.libraryFont ?? "Roboto" }
                : { fontFamily: fontFamily as ThemeV1["fontFamily"] },
            )
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
      {theme.fontFamily === "library" && (
        <FontLibraryPicker
          value={theme.libraryFont}
          previewText={formTitle}
          scripts={scripts}
          onChange={(libraryFont) => set({ fontFamily: "library", libraryFont })}
        />
      )}
      <PanelField
        label="Heading font"
        hint="Titles and questions. At most two fonts load, so forms stay fast."
      >
        <Select
          value={theme.headingFont ? "library" : "same"}
          onValueChange={(v) =>
            set(
              v === "same"
                ? { headingFont: undefined, headingWeight: undefined }
                : {
                    headingFont:
                      theme.headingFont ?? theme.libraryFont ?? "Playfair Display",
                    headingWeight: theme.headingWeight ?? 700,
                  },
            )
          }
        >
          <SelectTrigger className="h-[38px] w-full" aria-label="Heading font">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="same">Same as the body</SelectItem>
            <SelectItem value="library">From the font library</SelectItem>
          </SelectContent>
        </Select>
      </PanelField>
      {theme.headingFont && (
        <>
          <FontLibraryPicker
            value={theme.headingFont}
            previewText={formTitle}
            scripts={scripts}
            weight={theme.headingWeight ?? 700}
            onChange={(headingFont) => set({ headingFont })}
          />
          <Segmented
            label="Heading weight"
            value={String(theme.headingWeight ?? 700)}
            options={[
              { value: "400", label: "Regular" },
              { value: "600", label: "Semibold" },
              { value: "700", label: "Bold" },
            ]}
            onChange={(w) => set({ headingWeight: Number(w) as 400 | 600 | 700 })}
          />
        </>
      )}
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
      <PanelField
        label="Corner radius"
        hint={`${theme.cornerRadius ?? 8}px on fields and choices`}
      >
        <Slider
          aria-label="Corner radius"
          min={0}
          max={24}
          step={1}
          value={[theme.cornerRadius ?? 8]}
          onValueChange={([r]) => set({ cornerRadius: r })}
        />
      </PanelField>
      <Segmented
        label="Spacing"
        value={theme.spacing ?? "comfortable"}
        options={[
          { value: "compact", label: "Compact" },
          { value: "comfortable", label: "Comfortable" },
          { value: "spacious", label: "Spacious" },
        ]}
        onChange={(spacing) =>
          set({ spacing: spacing === "comfortable" ? undefined : spacing })
        }
      />
      <Segmented
        label="Progress bar"
        value={theme.showProgress === false ? "off" : "on"}
        options={[
          { value: "on", label: "Shown" },
          { value: "off", label: "Hidden" },
        ]}
        onChange={(value) => set({ showProgress: value === "off" ? false : undefined })}
      />
      {theme.showProgress !== false && (
        <PanelField
          label="Progress text"
          hint="Counted along the way your logic sends each person. Classic layouts count pages."
        >
          <Select
            value={theme.progressLabel ?? "none"}
            onValueChange={(value) =>
              set({
                progressLabel:
                  value === "none"
                    ? undefined
                    : (value as "percent" | "count" | "remaining"),
              })
            }
          >
            <SelectTrigger className="h-[38px] w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None, just the bar</SelectItem>
              <SelectItem value="percent">Percentage (40% complete)</SelectItem>
              <SelectItem value="count">Count (Question 3 of 8)</SelectItem>
              <SelectItem value="remaining">Remaining (5 questions left)</SelectItem>
            </SelectContent>
          </Select>
        </PanelField>
      )}

      <Segmented
        label="Background"
        value={theme.backgroundGradient ? "gradient" : "solid"}
        options={[
          { value: "solid", label: "Colour" },
          { value: "gradient", label: "Gradient" },
        ]}
        onChange={(v) =>
          set({
            backgroundGradient:
              v === "gradient"
                ? {
                    from: theme.backgroundColor,
                    to: theme.primaryColor,
                    angle: 180,
                  }
                : undefined,
          })
        }
      />
      {theme.backgroundGradient && (
        <>
          <ColorField
            label="Gradient from"
            value={theme.backgroundGradient.from}
            onChange={(from) =>
              HEX_RE.test(from) &&
              set({ backgroundGradient: { ...theme.backgroundGradient!, from } })
            }
          />
          <ColorField
            label="Gradient to"
            value={theme.backgroundGradient.to}
            onChange={(to) =>
              HEX_RE.test(to) &&
              set({ backgroundGradient: { ...theme.backgroundGradient!, to } })
            }
          />
        </>
      )}

      <SectionHead>Images</SectionHead>
      <ImageUploadField
        label="Logo"
        noun="a logo"
        meta="Top left, 32px tall"
        workspaceId={workspaceId}
        formId={formId}
        value={theme.logoUrl}
        onChange={(logoUrl) => onChange((current) => ({ ...current, logoUrl }))}
      />
      <ImageUploadField
        label="Background image"
        noun="an image"
        meta="Cover · a 72% scrim keeps text readable"
        workspaceId={workspaceId}
        formId={formId}
        value={theme.backgroundImageUrl}
        onChange={(backgroundImageUrl) =>
          onChange((current) => ({ ...current, backgroundImageUrl }))
        }
      />
      {onLayoutChange && (
        <>
          <SectionHead>Layout</SectionHead>
          <div className="col-span-full">
            <Segmented
              label="How questions appear"
              value={layout}
              options={[
                { value: "conversational", label: "One at a time" },
                { value: "classic", label: "Classic pages" },
              ]}
              onChange={onLayoutChange}
            />
          </div>
          <PanelNote>
            {layout === "classic"
              ? "Several questions per page. Add page breaks (Add question → Page break) to split it into pages. Logic, scores and validation work the same."
              : "Each question on its own screen. Page breaks are ignored."}
          </PanelNote>
          {onReviewStepChange && (
            <div className="col-span-full">
              <Segmented
                label="Before submitting"
                value={reviewStep ? "review" : "submit"}
                options={[
                  { value: "submit", label: "Submit straight away" },
                  { value: "review", label: "Review answers" },
                ]}
                onChange={(value) => onReviewStepChange(value === "review")}
              />
            </div>
          )}
          {layout !== "classic" && onAutoAdvanceChange && (
            <div className="col-span-full">
              <Segmented
                label="After a single choice"
                value={autoAdvance === false ? "wait" : "advance"}
                options={[
                  { value: "advance", label: "Move on" },
                  { value: "wait", label: "Wait for OK" },
                ]}
                onChange={(value) => onAutoAdvanceChange(value === "advance")}
              />
            </div>
          )}
        </>
      )}
      {linkThemes && <LinkThemes theme={theme} {...linkThemes} />}
      <SectionHead>Custom CSS</SectionHead>
      <CustomCssEditor
        value={theme.customCss}
        onChange={(customCss) => onChange((current) => ({ ...current, customCss }))}
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
