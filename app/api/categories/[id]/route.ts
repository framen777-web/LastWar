import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateCategoryInput, type CategoryInput } from "@/lib/categories/validate";
import { recomputeCategoryFromRawValue } from "@/lib/pipeline/run";
import { requireAdminApi } from "@/lib/auth/dal";

const RECOMPUTE_TRIGGER_FIELDS = ["divisor", "valueField", "importMode", "dedupField"] as const;

export async function PATCH(request: Request, ctx: RouteContext<"/api/categories/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const categoryId = Number(id);

  const existing = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!existing) {
    return NextResponse.json({ errors: [{ field: "id", message: "Category not found." }] }, { status: 404 });
  }

  const patch = (await request.json()) as CategoryInput;

  const merged: CategoryInput = {
    name: patch.name ?? existing.name,
    description: patch.description !== undefined ? patch.description : existing.description,
    shape: patch.shape ?? existing.shape,
    divisor: patch.divisor ?? existing.divisor,
    divisorLabel: patch.divisorLabel !== undefined ? patch.divisorLabel : existing.divisorLabel,
    importMode: patch.importMode ?? existing.importMode,
    dedupField: patch.dedupField !== undefined ? patch.dedupField : existing.dedupField,
    storedFields: patch.storedFields ?? JSON.parse(existing.storedFields),
    valueField: patch.valueField ?? existing.valueField,
    active: patch.active !== undefined ? patch.active : existing.active,
    cumulative: patch.cumulative !== undefined ? patch.cumulative : existing.cumulative,
    summaryMode: patch.summaryMode ?? existing.summaryMode,
    conductorMode: patch.conductorMode ?? existing.conductorMode,
    conductorPointsPerUnit: patch.conductorPointsPerUnit !== undefined ? patch.conductorPointsPerUnit : existing.conductorPointsPerUnit,
    conductorUnitSize: patch.conductorUnitSize !== undefined ? patch.conductorUnitSize : existing.conductorUnitSize,
    conductorFlatValue: patch.conductorFlatValue !== undefined ? patch.conductorFlatValue : existing.conductorFlatValue,
  };

  const errors = validateCategoryInput(merged);

  const name = merged.name?.trim() ?? "";
  const allOthers = await prisma.category.findMany({ where: { id: { not: categoryId } } });
  if (name && allOthers.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    errors.push({ field: "name", message: "A category with this name already exists." });
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  const needsRecompute = RECOMPUTE_TRIGGER_FIELDS.some((field) => patch[field] !== undefined && patch[field] !== (existing as unknown as Record<string, unknown>)[field]);

  const isFreeText = merged.shape === "free_text";
  const conductorMode = merged.conductorMode ?? "off";

  const updated = await prisma.category.update({
    where: { id: categoryId },
    data: {
      name,
      description: merged.description ?? null,
      shape: merged.shape,
      divisor: isFreeText ? 1 : merged.divisor,
      divisorLabel: isFreeText ? null : (merged.divisorLabel ?? null),
      importMode: isFreeText ? "single" : merged.importMode,
      dedupField: !isFreeText && merged.importMode === "multi" ? (merged.dedupField ?? null) : null,
      storedFields: JSON.stringify(merged.storedFields),
      valueField: isFreeText ? "" : merged.valueField,
      active: merged.active,
      sortOrder: patch.sortOrder ?? existing.sortOrder,
      cumulative: isFreeText ? false : (merged.cumulative ?? false),
      summaryMode: isFreeText ? "selected_week" : (merged.summaryMode ?? "selected_week"),
      conductorMode,
      conductorPointsPerUnit: conductorMode === "rate" ? (merged.conductorPointsPerUnit ?? null) : null,
      conductorUnitSize: conductorMode === "rate" ? (merged.conductorUnitSize ?? null) : null,
      conductorFlatValue: conductorMode === "flat" ? (merged.conductorFlatValue ?? null) : null,
    },
  });

  let recalculated = 0;
  if (needsRecompute) {
    recalculated = await recomputeCategoryFromRawValue(categoryId);
  }

  return NextResponse.json({ category: { ...updated, storedFields: JSON.parse(updated.storedFields) }, recalculated });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/categories/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const categoryId = Number(id);

  const category = await prisma.category.findUnique({ where: { id: categoryId } });
  if (!category) {
    return NextResponse.json({ errors: [{ field: "id", message: "Category not found." }] }, { status: 404 });
  }

  const recordCount = await prisma.categoryRecord.count({ where: { categoryId } });

  if (recordCount > 0) {
    await prisma.category.update({ where: { id: categoryId }, data: { active: false } });
    return NextResponse.json({ softDeleted: true, recordCount });
  }

  await prisma.category.delete({ where: { id: categoryId } });
  return NextResponse.json({ deleted: true });
}
