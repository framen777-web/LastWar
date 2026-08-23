import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { slugify } from "@/lib/categories/validate";
import { loadEditableSeason } from "@/lib/season/validate";

// Created with mode "rate" and blank points fields, same as the spec's "Add item" control -
// the admin fills in real point values afterward via PATCH on the created row.
export async function POST(request: Request, ctx: RouteContext<"/api/seasons/[id]/extra-items">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const seasonId = Number(id);

  const guard = await loadEditableSeason(seasonId);
  if ("error" in guard) return guard.error;

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim() ?? "";
  if (!name) return NextResponse.json({ error: "Name is required." }, { status: 400 });

  const existing = await prisma.seasonExtraItem.findMany({ where: { seasonId } });
  if (existing.some((i) => i.name.toLowerCase() === name.toLowerCase())) {
    return NextResponse.json({ error: "An item with this name already exists in this season." }, { status: 400 });
  }

  let key = slugify(name);
  const existingKeys = new Set(existing.map((i) => i.key));
  if (existingKeys.has(key)) {
    let suffix = 2;
    while (existingKeys.has(`${key}_${suffix}`)) suffix++;
    key = `${key}_${suffix}`;
  }

  const item = await prisma.seasonExtraItem.create({
    data: { seasonId, key, name, mode: "rate", pointsPerUnit: null, unitSize: null, flatValue: null },
  });

  return NextResponse.json({ item: { ...item, valueCount: 0 } }, { status: 201 });
}
