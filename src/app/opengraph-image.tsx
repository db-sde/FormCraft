import { ImageResponse } from "next/og";

export const alt = "FormCraft — forms people actually enjoy filling out.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#2b2118";

/** Marketing share image (Part 1 §0): cream card, headline, a tilted
 * question card on the right. */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 80px",
        background: "#f5efe4",
        color: INK,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div
          style={{
            width: 32,
            height: 32,
            background: "#f2b233",
            borderRadius: 8,
            transform: "rotate(-8deg)",
            boxShadow: `4px 4px 0 ${INK}`,
          }}
        />
        <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
          FormCraft
        </div>
      </div>
      <div
        style={{
          fontSize: 80,
          fontWeight: 700,
          lineHeight: 1.02,
          letterSpacing: "-0.035em",
          maxWidth: 720,
        }}
      >
        Forms people actually enjoy filling out.
      </div>
      <div
        style={{
          position: "absolute",
          right: -40,
          top: 92,
          width: 460,
          padding: 36,
          display: "flex",
          flexDirection: "column",
          gap: 20,
          border: `3px solid ${INK}`,
          borderRadius: 20,
          background: "#fffaf1",
          boxShadow: `8px 8px 0 ${INK}`,
          transform: "rotate(4deg)",
        }}
      >
        <div style={{ display: "flex", height: 6, width: "60%", background: "#e2d5c0" }}>
          <div style={{ width: "50%", background: "#f2b233" }} />
        </div>
        <div style={{ fontSize: 28, fontWeight: 600 }}>How did you hear about us?</div>
        {["A friend told me", "Search", "A podcast"].map((label, i) => (
          <div
            key={label}
            style={{
              padding: "14px 20px",
              border: `3px solid ${i === 0 ? INK : "#e2d5c0"}`,
              borderRadius: 12,
              fontSize: 24,
              background: i === 0 ? "#f2b233" : "transparent",
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>,
    size,
  );
}
