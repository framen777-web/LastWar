import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { listSaveWeeks, createSaveWeek } from "@/lib/conductor/saveWeeks";
import { recalculateSelectionPoints } from "@/lib/conductor/points";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const saveWeeks = await listSaveWeeks();
  return NextResponse.json({ saveWeeks });
}

function validate(body: { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> }) {
  if (!Number.isInteger(body.weekNumber) || (body.weekNumber as number) < 1) {
    return "Week number must be a whole number >= 1.";
  }
  if (!body.endDate || Number.isNaN(new Date(body.endDate).getTime())) {
    return "End date is required.";
  }
  return null;
}

// Firm rule: any change to Save Week config recalculates every confirmed conductor
// selection's frozen points (see lib/conductor/points.ts's recalculateSelectionPoints) - a
// new or edited Save Week can change how many points a past week is now worth.
export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { weekNumber?: number; endDate?: string; active?: boolean; capValues?: Record<string, number> };
  const error = validate(body);
  if (error) return NextResponse.json({ error }, { status: 400 });

  const saveWeek = await createSaveWeek({
    weekNumber: body.weekNumber as number,
    endDate: body.endDate as string,
    active: body.active ?? true,
    capValues: body.capValues ?? {},
  });

  await recalculateSelectionPoints();

  return NextResponse.json({ saveWeek });
}
