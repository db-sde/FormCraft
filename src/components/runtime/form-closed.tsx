import { CalendarX2 } from "lucide-react";
import type { ThemeV1 } from "@/domains/forms/schema/v1";
import { Stage, stageDescClass, stageTitleClass } from "./stage";

/**
 * What respondents see once a form has closed or filled up (master spec
 * F-46, F-47): the form's own theme and title, and the creator's message.
 * The same screen whether the link was opened after closing or the form
 * closed while someone was filling it in, on a direct link or an embed.
 */
export function FormClosedScreen({
  theme,
  title,
  message,
  embedded = false,
}: {
  theme: ThemeV1;
  title: string;
  message: string;
  embedded?: boolean;
}) {
  return (
    <Stage
      theme={theme}
      className={embedded ? "min-h-[480px]" : "min-h-dvh"}
      data-testid="form-closed"
    >
      <CalendarX2 aria-hidden className="size-9 text-(--st-primary)" />
      <h1 className={stageTitleClass}>{title}</h1>
      <p role="status" className={`${stageDescClass} whitespace-pre-line`}>
        {message}
      </p>
    </Stage>
  );
}
