import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { updateSaveWeek, deleteSaveWeek } from "@/lib/conductor/saveWeeks";
import { recalculateSelectionPoints } from "@/lib/conductor/points";

function validate(body: { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> }) {
  if (!Number.isInteger(body.weekNumber) || (body.weekNumber as number) < 1) {
    return "Week number must be a whole number >= 1.";
  }
  if (!body.endDate || Number.isNaN(new Date(body.endDate).getTime())) {
    return "End date is required.";
  }
  return null;
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/conductor/save-weeks/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const body = (await request.json()) as { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> };
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const saveWeek = await updateSaveWeek(Number(id), {
    weekNumber: body.weekNumber as number,
    endDate: body.endDate as string,
    active: body.active ?? true,
    capValues: body.capValues ?? {},
  });

  await recalculateSelectionPoints();

  return NextResponse.json({ saveWeek });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/conductor/save-weeks/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  await deleteSaveWeek(Number(id));
  await recalculateSelectionPoints();

  return NextResponse.json({ ok: true });
}
