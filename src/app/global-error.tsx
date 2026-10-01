"use client";

/** Last-resort boundary for errors in the root layout itself, which
 * replaces the whole document — so it can't rely on the app's
 * stylesheet or fonts and styles itself inline (Part 7: "Critical
 * error", always dark). */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  const ink = "#f3ebdf";
  return (
    <html lang="en">
      <head>
        <title>FormCraft didn’t load</title>
      </head>
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          background: "#1c1713",
          color: ink,
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{ padding: "20px 28px", display: "flex", alignItems: "center", gap: 10 }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              background: "#f2b233",
              borderRadius: 5,
              transform: "rotate(-8deg)",
              boxShadow: `2px 2px 0 ${ink}`,
            }}
          />
          <b style={{ fontSize: 18 }}>FormCraft</b>
        </div>
        <main
          style={{
            flex: 1,
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "center",
            gap: 40,
            padding: "0 24px 40px",
          }}
        >
          <div style={{ position: "relative", width: 180, height: 180, flex: "none" }}>
            <div
              style={{
                position: "absolute",
                inset: "10px 20px 30px 0",
                border: `1.5px solid ${ink}`,
                borderRadius: 14,
                background: "#26201a",
                transform: "rotate(-8deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: "30px 0 10px 30px",
                border: `1.5px solid ${ink}`,
                borderRadius: 14,
                background: "#f2b233",
                transform: "rotate(6deg)",
                boxShadow: `4px 4px 0 ${ink}`,
                display: "grid",
                placeItems: "center",
                fontSize: 48,
                fontWeight: 700,
                color: "#2b2118",
              }}
            >
              ↻
            </div>
          </div>
          <div
            style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 380 }}
          >
            <h1
              style={{
                margin: 0,
                fontSize: 44,
                lineHeight: 1,
                letterSpacing: "-0.035em",
              }}
            >
              FormCraft didn’t load
            </h1>
            <p style={{ margin: 0, fontSize: 16, lineHeight: 1.55, color: "#b0a18e" }}>
              Something broke before the app could start. Reloading usually fixes it. Your
              forms and responses are safe.
            </p>
            <div style={{ marginTop: 6 }}>
              <button
                type="button"
                onClick={() => {
                  reset();
                  window.location.reload();
                }}
                style={{
                  height: 44,
                  padding: "0 18px",
                  border: `1.5px solid ${ink}`,
                  borderRadius: 6,
                  background: "#f2b233",
                  color: "#2b2118",
                  fontWeight: 700,
                  fontSize: 14.5,
                  boxShadow: `3px 3px 0 ${ink}`,
                  cursor: "pointer",
                }}
              >
                Reload
              </button>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
