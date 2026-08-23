import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { recomputeCategoryFromRawValue } from "@/lib/pipeline/run";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(_request: Request, ctx: RouteContext<"/api/categories/[id]/recompute">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const categoryId = Number(id);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    return NextResponse.json({ errors: [{ field: "id", message: "Category not found." }] }, { status: 404 });
  }

  const recalculated = await recomputeCategoryFromRawValue(categoryId);
  return NextResponse.json({ recalculated });
}
