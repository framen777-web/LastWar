import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { getBatchDetail, addManualEntry, cancelBatch } from "@/lib/verify/service";

export async function GET(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const detail = await getBatchDetail(categoryKey, Number(weekNumber));
  if (!detail) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  return NextResponse.json({ batch: detail });
}

export async function POST(request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const body = (await request.json()) as {
    team?: string | null;
    memberName?: string;
    rank?: number | null;
    value?: number | null;
    fields?: Record<string, number | undefined> | null;
  };
  if (!body.memberName) return NextResponse.json({ error: "memberName is required." }, { status: 400 });

  await addManualEntry(categoryKey, Number(weekNumber), {
    team: body.team ?? null,
    memberName: body.memberName,
    rank: body.rank ?? null,
    value: body.value ?? null,
    fields: body.fields ? JSON.stringify(body.fields) : null,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  try {
    await cancelBatch(categoryKey, Number(weekNumber));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
