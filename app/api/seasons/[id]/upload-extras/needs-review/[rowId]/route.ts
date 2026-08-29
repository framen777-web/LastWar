import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

// Dismisses one needs-review row once the admin has handled it (re-uploaded and picked the item
// manually, or decided it's not worth chasing). There's no confirm/approve action here - unlike
// RawExtraction, these rows never had the source image bytes saved, so there's nothing to apply
// from the row itself; re-uploading is the only path back to a committed value.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/seasons/[id]/upload-extras/needs-review/[rowId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id, rowId } = await ctx.params;
  const seasonId = Number(id);

  const existing = await prisma.rawSeasonExtraction.findUnique({ where: { id: Number(rowId) } });
  if (!existing || existing.seasonId !== seasonId) {
    return NextResponse.json({ error: "Row not found." }, { status: 404 });
  }

  await prisma.rawSeasonExtraction.delete({ where: { id: existing.id } });
  return NextResponse.json({ deleted: true });
}
