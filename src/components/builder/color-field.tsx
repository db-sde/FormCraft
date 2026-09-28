"use client";

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}) {
  const valid = HEX_RE.test(value);

  return (
    <div className="space-y-1.5">
      <Label className="text-muted-foreground text-xs font-medium">{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} swatch`}
          className="border-input size-8 shrink-0 cursor-pointer rounded-md border p-0.5"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
          aria-invalid={!valid}
          maxLength={7}
          className="font-mono"
        />
      </div>
      {!valid && (
        <p className="text-destructive text-xs">
          Enter a 6-digit hex color, e.g. #0f172a
        </p>
      )}
    </div>
  );
}
