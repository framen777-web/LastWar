import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const seasons = await prisma.season.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json({ seasons });
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { name?: string; weekStart?: number; weekEnd?: number; totalBoxes?: number };
  const name = body.name?.trim() ?? "";
  const weekStart = Number(body.weekStart);
  const weekEnd = Number(body.weekEnd);
  const totalBoxes = Number(body.totalBoxes);

  const errors: { field: string; message: string }[] = [];
  if (!name) errors.push({ field: "name", message: "Name is required." });
  if (!Number.isInteger(weekStart) || weekStart < 1) errors.push({ field: "weekStart", message: "Week start must be a positive integer." });
  if (!Number.isInteger(weekEnd) || weekEnd < weekStart) {
    errors.push({ field: "weekEnd", message: "Week end must be a positive integer, not before week start." });
  }
  if (!Number.isInteger(totalBoxes) || totalBoxes < 0) errors.push({ field: "totalBoxes", message: "Total boxes must be a non-negative integer." });

  if (name) {
    const existing = await prisma.season.findUnique({ where: { name } });
    if (existing) errors.push({ field: "name", message: "A season with this name already exists." });
  }

  if (errors.length > 0) return NextResponse.json({ errors }, { status: 400 });

  const season = await prisma.season.create({ data: { name, weekStart, weekEnd, totalBoxes } });
  return NextResponse.json({ season }, { status: 201 });
}
