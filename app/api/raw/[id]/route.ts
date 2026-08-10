import { NextResponse } from "next/server";
import { confirmRawExtraction, rejectRawExtraction } from "@/lib/pipeline/run";

export async function PATCH(request: Request, ctx: RouteContext<"/api/raw/[id]">) {
  const { id } = await ctx.params;
  const rawExtractionId = Number(id);

  const body = (await request.json()) as { action?: "confirm" | "reject" };

  try {
    if (body.action === "confirm") {
      await confirmRawExtraction(rawExtractionId);
    } else if (body.action === "reject") {
      await rejectRawExtraction(rawExtractionId);
    } else {
      return NextResponse.json({ error: "action must be 'confirm' or 'reject'" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
