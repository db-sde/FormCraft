"use client";

import { Plus, X, GripVertical } from "lucide-react";
import type { OptionV1 } from "@/domains/forms/schema/v1";
import { createOption } from "@/domains/forms/builder";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionV1[];
  onChange: (options: OptionV1[]) => void;
}) {
  function updateLabel(id: string, label: string) {
    onChange(options.map((o) => (o.id === id ? { ...o, label } : o)));
  }

  function remove(id: string) {
    if (options.length <= 1) return;
    onChange(options.filter((o) => o.id !== id));
  }

  function add() {
    onChange([...options, createOption(`Option ${options.length + 1}`)]);
  }

  return (
    <div className="space-y-2">
      {options.map((option, index) => (
        <div key={option.id} className="flex items-center gap-1.5">
          <GripVertical
            className="text-muted-foreground/50 size-3.5 shrink-0"
            aria-hidden
          />
          <Input
            value={option.label}
            onChange={(e) => updateLabel(option.id, e.target.value)}
            aria-label={`Option ${index + 1}`}
            className="h-8"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={options.length <= 1}
            aria-label={`Remove option ${index + 1}`}
            onClick={() => remove(option.id)}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={add}>
        <Plus /> Add option
      </Button>
    </div>
  );
}
