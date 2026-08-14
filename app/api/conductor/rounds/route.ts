import { NextResponse } from "next/server";
import { generateDraft } from "@/lib/conductor/selection";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { weeksInCycle?: number; startWeek?: number };
  const weeksInCycle = Number(body.weeksInCycle);
  const startWeek = Number(body.startWeek);

  if (!Number.isInteger(weeksInCycle) || weeksInCycle < 1) {
    return NextResponse.json({ error: "weeksInCycle must be a whole number >= 1." }, { status: 400 });
  }
  if (!Number.isInteger(startWeek) || startWeek < 1) {
    return NextResponse.json({ error: "startWeek must be a whole number >= 1." }, { status: 400 });
  }

  const draft = await generateDraft(weeksInCycle, startWeek);
  return NextResponse.json(draft, { status: 201 });
}
