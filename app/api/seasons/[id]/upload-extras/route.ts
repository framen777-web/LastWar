import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason } from "@/lib/season/validate";
import { runSeasonExtraPipelineForImage } from "@/lib/pipeline/runSeasonExtra";

// Same per-file convention as /api/upload: one file per request, called once per selected file
// from the client so per-file progress can be shown - each file already runs independently
// server-side, and a failure on one shouldn't block the rest.
export async function POST(request: Request, ctx: RouteContext<"/api/seasons/[id]/upload-extras">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const formData = await request.formData();
  const itemKeyParam = formData.get("itemKey");
  const forcedItemKey = typeof itemKeyParam === "string" && itemKeyParam !== "" ? itemKeyParam : undefined;

  if (forcedItemKey) {
    const item = await prisma.seasonExtraItem.findFirst({ where: { seasonId, key: forcedItemKey } });
    if (!item) return NextResponse.json({ error: "Unknown item for this season." }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const results = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const result = await runSeasonExtraPipelineForImage({
      filename: file.name,
      buffer,
      mimeType: file.type || "image/png",
      seasonId,
      forcedItemKey,
    });
    results.push(result);
  }

  return NextResponse.json({ results });
}
