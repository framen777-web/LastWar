import { NextResponse } from "next/server";
import { confirmRawExtraction, rejectRawExtraction, reprocessNeedsReview } from "@/lib/pipeline/run";
import { requireAdminApi } from "@/lib/auth/dal";

export async function PATCH(request: Request, ctx: RouteContext<"/api/raw/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const rawExtractionId = Number(id);

  const body = (await request.json()) as { action?: "confirm" | "reject" | "reprocess"; categoryKey?: string };

  try {
    if (body.action === "confirm") {
      await confirmRawExtraction(rawExtractionId);
    } else if (body.action === "reject") {
      await rejectRawExtraction(rawExtractionId);
    } else if (body.action === "reprocess") {
      if (!body.categoryKey) {
        return NextResponse.json({ error: "categoryKey is required to reprocess." }, { status: 400 });
      }
      await reprocessNeedsReview(rawExtractionId, body.categoryKey);
    } else {
      return NextResponse.json({ error: "action must be 'confirm', 'reject', or 'reprocess'" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
