import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_URL = (process.env.AGENT_SERVICE_URL || "http://localhost:8787").replace(/\/$/, "");
const SECRET = (process.env.OPENLIVE_AGENT_SECRET || "").trim();

export async function GET() {
  try {
    const response = await fetch(`${AGENT_URL}/audit`, {
      cache: "no-store",
      headers: SECRET ? { "x-openlive-secret": SECRET } : {},
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Agent HTTP ${response.status}`);
    return NextResponse.json(await response.json(), { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The live authority report is temporarily unavailable." }, { status: 503 });
  }
}
