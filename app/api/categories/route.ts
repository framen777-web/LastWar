import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { validateCategoryInput, slugify, type CategoryInput } from "@/lib/categories/validate";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const categories = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  const counts = await prisma.categoryRecord.groupBy({ by: ["categoryId"], _count: { _all: true } });
  const countByCategoryId = new Map(counts.map((c) => [c.categoryId, c._count._all]));

  return NextResponse.json({
    categories: categories.map((c) => ({ ...serialize(c), recordCount: countByCategoryId.get(c.id) ?? 0 })),
  });
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as CategoryInput;

  const errors = validateCategoryInput(body);

  const name = body.name?.trim() ?? "";
  const existing = await prisma.category.findMany();
  if (name && existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    errors.push({ field: "name", message: "A category with this name already exists." });
  }

  if (errors.length > 0) {
    return NextResponse.json({ errors }, { status: 400 });
  }

  let key = slugify(name);
  const existingKeys = new Set(existing.map((c) => c.key));
  if (existingKeys.has(key)) {
    let suffix = 2;
    while (existingKeys.has(`${key}_${suffix}`)) suffix++;
    key = `${key}_${suffix}`;
  }

  const maxSortOrder = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1);

  const isFreeText = body.shape === "free_text";

  const conductorMode = body.conductorMode ?? "off";
  const category = await prisma.category.create({
    data: {
      key,
      name,
      description: body.description ?? null,
      shape: body.shape!,
      divisor: isFreeText ? 1 : body.divisor!,
      divisorLabel: isFreeText ? null : (body.divisorLabel ?? null),
      importMode: isFreeText ? "single" : body.importMode!,
      dedupField: !isFreeText && body.importMode === "multi" ? (body.dedupField ?? null) : null,
      storedFields: JSON.stringify(body.storedFields),
      valueField: isFreeText ? "" : body.valueField!,
      active: body.active ?? true,
      sortOrder: maxSortOrder + 1,
      cumulative: isFreeText ? false : (body.cumulative ?? false),
      conductorMode,
      conductorPointsPerUnit: conductorMode === "rate" ? (body.conductorPointsPerUnit ?? null) : null,
      conductorUnitSize: conductorMode === "rate" ? (body.conductorUnitSize ?? null) : null,
      conductorFlatValue: conductorMode === "flat" ? (body.conductorFlatValue ?? null) : null,
    },
  });

  return NextResponse.json({ category: serialize(category) }, { status: 201 });
}

function serialize(category: {
  storedFields: string;
  [key: string]: unknown;
}): Record<string, unknown> {
  return { ...category, storedFields: JSON.parse(category.storedFields) };
}
