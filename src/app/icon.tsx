import { ImageResponse } from "next/og";

// Favicon: the marigold mark on ink, so it reads in light and dark tabs.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2b2118",
        borderRadius: 7,
      }}
    >
      <div
        style={{
          width: 15,
          height: 15,
          background: "#f2b233",
          borderRadius: 3,
          transform: "rotate(-8deg)",
        }}
      />
    </div>,
    size,
  );
}
