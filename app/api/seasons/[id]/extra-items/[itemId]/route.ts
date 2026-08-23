import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { loadEditableSeason, validateRateFlat } from "@/lib/season/validate";

export async function PATCH(request: Request, ctx: RouteContext<"/api/seasons/[id]/extra-items/[itemId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id, itemId } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const existing = await prisma.seasonExtraItem.findUnique({ where: { id: Number(itemId) } });
  if (!existing || existing.seasonId !== seasonId) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    name?: string;
    mode?: string;
    pointsPerUnit?: number | null;
    unitSize?: number | null;
    flatValue?: number | null;
  };

  const mode = body.mode ?? existing.mode;
  const err = validateRateFlat({ mode, pointsPerUnit: body.pointsPerUnit, unitSize: body.unitSize, flatValue: body.flatValue });
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const item = await prisma.seasonExtraItem.update({
    where: { id: existing.id },
    data: {
      name: body.name !== undefined ? body.name.trim() || existing.name : existing.name,
      mode,
      pointsPerUnit: mode === "rate" ? (body.pointsPerUnit ?? existing.pointsPerUnit) : null,
      unitSize: mode === "rate" ? (body.unitSize ?? existing.unitSize) : null,
      flatValue: mode === "flat" ? (body.flatValue ?? existing.flatValue) : null,
    },
  });

  return NextResponse.json({ item });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/seasons/[id]/extra-items/[itemId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id, itemId } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const existing = await prisma.seasonExtraItem.findUnique({ where: { id: Number(itemId) } });
  if (!existing || existing.seasonId !== seasonId) {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }

  await prisma.seasonExtraItem.delete({ where: { id: existing.id } }); // cascades SeasonExtraValue rows
  return NextResponse.json({ deleted: true });
}
