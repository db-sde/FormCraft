import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2b2118",
      }}
    >
      <div
        style={{
          width: 78,
          height: 78,
          background: "#f2b233",
          borderRadius: 18,
          transform: "rotate(-8deg)",
          boxShadow: "9px 9px 0 #fffaf1",
        }}
      />
    </div>,
    size,
  );
}
