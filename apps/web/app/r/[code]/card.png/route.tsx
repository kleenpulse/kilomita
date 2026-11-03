import { ImageResponse } from "next/og";
import { APP_NAME, TAGLINE } from "@kilomita/shared";
import { decodeShareCode } from "@/lib/share-code";
import { NOT_CHECKED, cardText } from "../card";

/*
 * The WhatsApp / X preview for a share link: 1200×630, drawn from the code alone. A valid code
 * always draws the same picture, so it may be cached for good; a 404 may not (a code dated
 * tomorrow becomes valid tomorrow).
 */

const GREEN = "#047857";

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 260 }}>
      <div style={{ display: "flex", fontSize: 28, color: "#525252" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", fontSize: 64, color: "#171717" }}>
        {value}
        <div style={{ display: "flex", marginLeft: 10, fontSize: 30, color: "#525252" }}>
          {unit}
        </div>
      </div>
    </div>
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const card = decodeShareCode(code, Date.now());
  if (!card) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  }
  const text = cardText(card);
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "56px 64px",
        backgroundColor: "#ffffff",
        borderTop: `16px solid ${GREEN}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ display: "flex", fontSize: 40, color: GREEN }}>{APP_NAME}</div>
        <div style={{ display: "flex", fontSize: 28, color: "#525252" }}>{TAGLINE}</div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", marginTop: 36 }}>
        <div style={{ display: "flex", fontSize: 168, lineHeight: 1, color: "#171717" }}>
          {text.download}
        </div>
        <div style={{ display: "flex", marginLeft: 20, fontSize: 48, color: "#525252" }}>
          Mbps download
        </div>
      </div>
      <div style={{ display: "flex", marginTop: 36, gap: 24 }}>
        <Stat label="Upload" value={text.upload} unit="Mbps" />
        <Stat label="Latency" value={text.latency} unit="ms" />
        <Stat label="Bufferbloat" value={text.grade} unit="grade" />
      </div>
      <div style={{ display: "flex", flexGrow: 1 }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26 }}>
        <div style={{ display: "flex", color: "#171717" }}>
          {text.place ? `${text.place} · ${text.day}` : text.day}
        </div>
        <div style={{ display: "flex", color: "#525252" }}>{NOT_CHECKED}</div>
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      headers: { "cache-control": "public, max-age=31536000, immutable" },
    },
  );
}
