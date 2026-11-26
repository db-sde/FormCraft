"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Trash2 } from "lucide-react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import {
  THEME_GROUPS,
  THEME_PRESETS,
  applyPreset,
  type ThemeGroup,
} from "@/domains/themes/presets";
import { onPrimaryColor, stageTextColor } from "@/components/runtime/stage-theme";
import { themeFontStack } from "@/components/theme-styles";
import {
  deleteBrandThemeAction,
  listBrandThemesAction,
  saveBrandThemeAction,
  type BrandTheme,
} from "@/app/(form)/forms/[id]/brand-theme-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/lib/toast";
import { cn } from "cn";

const RADIUS = { rounded: "6px", square: "0", pill: "999px" } as const;

function background(t: ThemeV1): React.CSSProperties {
  return t.backgroundGradient
    ? {
        backgroundColor: t.backgroundColor,
        backgroundImage: `linear-gradient(${t.backgroundGradient.angle}deg, ${t.backgroundGradient.from}, ${t.backgroundGradient.to})`,
      }
    : { backgroundColor: t.backgroundColor };
}

function fontHref(family: string, weights: number[]) {
  return `/fonts/css?family=${encodeURIComponent(family)}&w=${weights.join(",")}`;
}

/** A bigger look at a theme: its fonts, a field and the button. */
function ThemePreview({ theme, title }: { theme: ThemeV1; title: string }) {
  const text = stageTextColor(theme);
  const heading = theme.headingFont
    ? `"${theme.headingFont}", ${themeFontStack(theme)}`
    : themeFontStack(theme);
  return (
    <div
      className="border-ink flex flex-col gap-2.5 rounded-[8px] border-[1.5px] p-4"
      style={{ ...background(theme), color: text, fontFamily: themeFontStack(theme) }}
      aria-label="Theme preview"
    >
      {theme.fontFamily === "library" && theme.libraryFont && (
        <link rel="stylesheet" href={fontHref(theme.libraryFont, [400, 600])} />
      )}
      {theme.headingFont && (
        <link
          rel="stylesheet"
          href={fontHref(theme.headingFont, [theme.headingWeight ?? 700])}
        />
      )}
      <span
        className="text-[19px] leading-tight"
        style={{ fontFamily: heading, fontWeight: theme.headingWeight ?? 700 }}
      >
        {title || "What should we call you?"}
      </span>
      <span
        className="h-9 border px-2.5 py-2 text-[13px] opacity-80"
        style={{
          borderColor: `color-mix(in oklab, ${text} 30%, transparent)`,
          borderRadius: `${theme.cornerRadius ?? 8}px`,
        }}
      >
        Type your answer here…
      </span>
      <span
        className="self-start px-4 py-1.5 text-[13px] font-semibold"
        style={{
          background: theme.primaryColor,
          color: onPrimaryColor(theme),
          borderRadius:
            theme.buttonStyle === "rounded" && theme.cornerRadius !== undefined
              ? `${theme.cornerRadius}px`
              : RADIUS[theme.buttonStyle],
        }}
      >
        OK
      </span>
    </div>
  );
}

function Swatch({
  name,
  theme,
  on,
  onPick,
  onPeek,
}: {
  name: string;
  theme: Omit<ThemeV1, "preset">;
  on: boolean;
  onPick: () => void;
  onPeek: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onPick}
      onMouseEnter={onPeek}
      onFocus={onPeek}
      className={cn(
        "fc-focus bg-card flex flex-col gap-1.5 rounded-[8px] border-[1.5px] p-1.5 text-left",
        on ? "border-ink shadow-card" : "border-border hover:border-input",
      )}
    >
      <span
        aria-hidden
        className="flex h-[52px] flex-col justify-center gap-[5px] rounded-[5px] px-2.5"
        style={background(theme as ThemeV1)}
      >
        <span
          className="h-1.5 w-[70%] rounded-[2px]"
          style={{ background: theme.textColor ?? stageTextColor(theme as ThemeV1) }}
        />
        <span
          className="h-3 w-[34px]"
          style={{
            background: theme.primaryColor,
            borderRadius: RADIUS[theme.buttonStyle],
          }}
        />
      </span>
      <span className="flex items-center justify-between text-[13px] font-semibold">
        <span className="truncate">{name}</span>
        {on && <Check className="size-[13px] shrink-0" />}
      </span>
    </button>
  );
}

/**
 * The theme gallery (developer spec item 3): the workspace's brand themes,
 * then 50+ presets by group. Hovering or tapping one shows it larger;
 * picking one copies its values into the form's theme.
 */
export function ThemeGallery({
  theme,
  formTitle,
  canSave,
  onApply,
}: {
  theme: ThemeV1;
  formTitle: string;
  canSave: boolean;
  onApply: (theme: ThemeV1) => void;
}) {
  const [group, setGroup] = useState<ThemeGroup | "all" | "brand">("all");
  const [all, setAll] = useState(false);
  const [peek, setPeek] = useState<ThemeV1 | null>(null);
  const [brand, setBrand] = useState<BrandTheme[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    listBrandThemesAction()
      .then((rows) => live && setBrand(rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const presets =
    group === "all" || group === "brand"
      ? THEME_PRESETS
      : THEME_PRESETS.filter((p) => p.group === group);
  const shown =
    group === "brand"
      ? []
      : all || group !== "all"
        ? presets
        : presets.filter((p, i) => i < 8 || p.id === theme.preset);

  return (
    <div className="col-span-full flex flex-col gap-2">
      <span className="text-[13.5px] font-semibold">Themes</span>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Theme style">
        {[
          ["all", "All"],
          ...(brand.length ? [["brand", "Brand"]] : []),
          ...THEME_GROUPS.map((g) => [g.id, g.label]),
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={group === id}
            onClick={() => setGroup(id as typeof group)}
            className={cn(
              "fc-focus h-7 rounded-[5px] border-[1.5px] px-2 text-[12px] font-semibold",
              group === id
                ? "border-foreground bg-foreground text-background"
                : "border-input",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <ThemePreview theme={peek ?? theme} title={formTitle} />
      {(group === "all" || group === "brand") && brand.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {brand.map((b) => (
            <div key={b.id} className="relative">
              <Swatch
                name={b.name}
                theme={b.theme}
                on={false}
                onPeek={() => setPeek({ ...theme, ...b.theme })}
                onPick={() => onApply({ ...theme, ...b.theme, preset: undefined })}
              />
              {canSave && (
                <button
                  type="button"
                  aria-label={`Delete ${b.name}`}
                  className="text-muted-foreground hover:text-foreground absolute top-2 right-2 rounded-xs bg-white/80 p-0.5"
                  onClick={() =>
                    start(async () => {
                      const result = await deleteBrandThemeAction(b.id);
                      if (result.ok)
                        setBrand((rows) => rows.filter((r) => r.id !== b.id));
                      else toast.error(result.message);
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2" onMouseLeave={() => setPeek(null)}>
        {shown.map((preset) => (
          <Swatch
            key={preset.id}
            name={preset.name}
            theme={preset.theme}
            on={theme.preset === preset.id}
            onPeek={() => setPeek(applyPreset(theme, preset))}
            onPick={() => onApply(applyPreset(theme, preset))}
          />
        ))}
      </div>
      {group === "all" && (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="fc-focus text-muted-foreground hover:text-foreground self-start text-[12.5px] font-semibold underline-offset-2 hover:underline"
        >
          {all ? "Show fewer themes" : `Show all ${THEME_PRESETS.length} themes`}
        </button>
      )}
      {canSave &&
        (naming ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const result = await saveBrandThemeAction(name, theme);
                if (result.ok) {
                  setBrand((rows) => [result.theme, ...rows]);
                  setNaming(false);
                  setName("");
                  toast.success("Saved as a brand theme for this workspace.");
                } else toast.error(result.message);
              });
            }}
          >
            <Input
              aria-label="Brand theme name"
              placeholder="Acme brand"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-8"
            />
            <Button size="sm" disabled={pending || !name.trim()}>
              Save
            </Button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="fc-focus text-muted-foreground hover:text-foreground self-start text-[12.5px] font-semibold underline-offset-2 hover:underline"
          >
            Save as a workspace brand theme
          </button>
        ))}
    </div>
  );
}
