import "server-only";
import { ImageResponse } from "next/og";
import { stageTextColor } from "@/components/runtime/stage-theme";
import type { ThemeV1 } from "./schema/v1";

/**
 * The automatic share card (developer spec item 1): the form's title on
 * its theme's colours, 1200 × 630. Free forms carry the FormCraft badge.
 * Made once at publish time and stored, never per request.
 */
export async function renderShareCard(input: {
  title: string;
  theme: Pick<ThemeV1, "primaryColor" | "backgroundColor" | "textColor">;
  badge: boolean;
}): Promise<Buffer> {
  const hex = /^#[0-9a-fA-F]{6}$/;
  const bg = hex.test(input.theme.backgroundColor)
    ? input.theme.backgroundColor
    : "#fffaf1";
  const primary = hex.test(input.theme.primaryColor)
    ? input.theme.primaryColor
    : "#f2b233";
  const text = stageTextColor({ ...input.theme, backgroundColor: bg } as ThemeV1);
  const title = input.title.trim().slice(0, 120) || "Untitled form";
  const response = new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        background: bg,
        color: text,
        padding: "72px 80px",
      }}
    >
      <div
        style={{
          display: "flex",
          width: 120,
          height: 14,
          background: primary,
          borderRadius: 7,
        }}
      />
      <div
        style={{
          display: "flex",
          fontSize: title.length > 60 ? 64 : 80,
          fontWeight: 700,
          lineHeight: 1.08,
          letterSpacing: "-0.03em",
        }}
      >
        {title}
      </div>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
      >
        <div
          style={{
            display: "flex",
            background: primary,
            color: stageTextColor({ backgroundColor: primary } as ThemeV1),
            fontSize: 30,
            fontWeight: 700,
            padding: "14px 30px",
            borderRadius: 12,
          }}
        >
          Start
        </div>
        {input.badge && (
          <div style={{ display: "flex", fontSize: 26, opacity: 0.75 }}>
            Made with FormCraft
          </div>
        )}
      </div>
    </div>,
    { width: 1200, height: 630 },
  );
  return Buffer.from(await response.arrayBuffer());
}
