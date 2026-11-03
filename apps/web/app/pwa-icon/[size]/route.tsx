import { ImageResponse } from "next/og";

/*
 * The install icons, drawn from app/icon.svg's gauge, so no image file is committed. "maskable"
 * fills the whole square and keeps the gauge inside the central safe zone, for launchers that crop
 * icons into circles or squircles.
 */

const GREEN = "#047857";
const GAUGE =
  '<path d="M7 22a9 9 0 0 1 18 0" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M16 22l5.5-6.5" stroke="#fff" stroke-width="3" stroke-linecap="round"/>';
const ROUNDED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${GREEN}"/>${GAUGE}</svg>`;
const BARE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${GAUGE}</svg>`;

const ICONS = {
  "192": { px: 192, maskable: false },
  "512": { px: 512, maskable: false },
  maskable: { px: 512, maskable: true },
} as const;

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(ICONS).map((size) => ({ size }));
}

const dataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const icon = ICONS[size as keyof typeof ICONS] as (typeof ICONS)[keyof typeof ICONS] | undefined;
  if (!icon) return new Response("Not found", { status: 404 });
  const { px, maskable } = icon;
  const inner = maskable ? Math.round(px * 0.6) : px;
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: maskable ? GREEN : "transparent",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- drawn by next/og, not a page */}
      <img alt="" width={inner} height={inner} src={dataUri(maskable ? BARE : ROUNDED)} />
    </div>,
    { width: px, height: px },
  );
}
