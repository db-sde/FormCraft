"use client";

import { AlertTriangle } from "lucide-react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { THEME_PRESETS, isReadableContrast } from "@/domains/themes";
import { ColorField } from "./color-field";
import { ImageUploadField } from "./image-upload-field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "cn";

export function ThemeSettingsPanel({
  theme,
  workspaceId,
  formId,
  onChange,
}: {
  theme: ThemeV1;
  workspaceId: string;
  formId: string;
  onChange: (next: ThemeV1) => void;
}) {
  const buttonContrastOk = isReadableContrast(theme.primaryColor, "#ffffff");
  const textContrastOk = isReadableContrast(
    theme.textColor ?? theme.primaryColor,
    theme.backgroundColor,
  );

  return (
    <div className="space-y-5">
      <div>
        <Label className="text-muted-foreground mb-2 block text-xs font-medium">
          Presets
        </Label>
        <div className="grid grid-cols-3 gap-2">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onChange({ ...theme, ...preset.theme, preset: preset.id })}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md border p-2 text-xs",
                theme.preset === preset.id
                  ? "border-foreground/30 ring-foreground/10 ring-1"
                  : "hover:bg-accent/50 border-transparent",
              )}
            >
              <span
                className="size-6 rounded-full border"
                style={{ backgroundColor: preset.theme.primaryColor }}
                aria-hidden
              />
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      <Separator />

      <ColorField
        label="Primary color"
        value={theme.primaryColor}
        onChange={(primaryColor) =>
          onChange({ ...theme, primaryColor, preset: undefined })
        }
      />
      {!buttonContrastOk && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          This color may be hard to read as white button text.
        </p>
      )}

      <ColorField
        label="Background color"
        value={theme.backgroundColor}
        onChange={(backgroundColor) =>
          onChange({ ...theme, backgroundColor, preset: undefined })
        }
      />
      <ColorField
        label="Text color"
        value={theme.textColor ?? theme.primaryColor}
        onChange={(textColor) => onChange({ ...theme, textColor, preset: undefined })}
      />
      {!textContrastOk && (
        <p className="flex items-start gap-1.5 text-xs text-amber-600">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          Text and background colors may be hard to read together.
        </p>
      )}

      <Separator />

      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs font-medium">Font</Label>
        <Select
          value={theme.fontFamily}
          onValueChange={(fontFamily) =>
            onChange({
              ...theme,
              fontFamily: fontFamily as ThemeV1["fontFamily"],
              preset: undefined,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inter">Inter</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="georgia">Georgia</SelectItem>
            <SelectItem value="mono">Mono</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-muted-foreground text-xs font-medium">Button style</Label>
        <Select
          value={theme.buttonStyle}
          onValueChange={(buttonStyle) =>
            onChange({
              ...theme,
              buttonStyle: buttonStyle as ThemeV1["buttonStyle"],
              preset: undefined,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rounded">Rounded</SelectItem>
            <SelectItem value="square">Square</SelectItem>
            <SelectItem value="pill">Pill</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <ImageUploadField
        label="Logo"
        workspaceId={workspaceId}
        formId={formId}
        value={theme.logoUrl}
        onChange={(logoUrl) => onChange({ ...theme, logoUrl })}
      />
      <ImageUploadField
        label="Background image"
        workspaceId={workspaceId}
        formId={formId}
        value={theme.backgroundImageUrl}
        onChange={(backgroundImageUrl) => onChange({ ...theme, backgroundImageUrl })}
      />
    </div>
  );
}
