"use client";

import type { EndingV1 } from "@/domains/forms/schema/v1";
import { Input } from "@/components/ui/input";
import { PANEL_INPUT, PanelField, SwitchRow } from "./panel-ui";

/** Settings for the selected ending (Part 4, right panel). Its title
 * and description are edited on the canvas. */
export function EndingSettingsPanel({
  ending,
  onChange,
}: {
  ending: EndingV1;
  onChange: (next: EndingV1) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-4">
      <PanelField
        label="Redirect URL (optional)"
        hint="When set, a button takes people to this page."
      >
        <Input
          type="url"
          className={PANEL_INPUT}
          value={ending.redirectUrl ?? ""}
          placeholder="https://example.com/thanks"
          onChange={(e) =>
            onChange({ ...ending, redirectUrl: e.target.value || undefined })
          }
        />
      </PanelField>
      <PanelField label="Button label" hint="Shown with a redirect URL.">
        <Input
          className={PANEL_INPUT}
          value={ending.buttonLabel ?? ""}
          placeholder="Continue"
          onChange={(e) => onChange({ ...ending, buttonLabel: e.target.value })}
        />
      </PanelField>
      <SwitchRow
        label="Show “Made with FormCraft”"
        checked={ending.showMadeWith !== false}
        onCheckedChange={(on) => onChange({ ...ending, showMadeWith: on })}
      />
    </div>
  );
}
