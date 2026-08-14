import { NextResponse } from "next/server";
import {
  DEFAULT_CONDUCTOR_SETTINGS,
  getConductorSettings,
  saveConductorSettings,
  WEEKDAYS,
  type ConductorSettings,
} from "@/lib/conductor/settings";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const settings = await getConductorSettings();
  return NextResponse.json({ settings });
}

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as Partial<ConductorSettings>;
  const current = await getConductorSettings();
  const merged: ConductorSettings = {
    ...DEFAULT_CONDUCTOR_SETTINGS,
    ...current,
    ...body,
    weekdayRules: { ...current.weekdayRules, ...(body.weekdayRules ?? {}) },
  };

  if (!Number.isInteger(merged.fromWeek) || merged.fromWeek < 1) {
    return NextResponse.json({ error: "From week must be a whole number >= 1." }, { status: 400 });
  }
  if (!Number.isInteger(merged.weeksPerSelect) || merged.weeksPerSelect < 1) {
    return NextResponse.json({ error: "Weeks per select must be a whole number >= 1." }, { status: 400 });
  }
  for (const day of WEEKDAYS) {
    const rule = merged.weekdayRules[day];
    if (!rule || ("random" in rule ? rule.random !== true : !rule.categoryKey || !Number.isInteger(rule.rank) || rule.rank < 1)) {
      return NextResponse.json({ error: `Weekday rule for ${day} must be Random or a field with rank >= 1.` }, { status: 400 });
    }
  }

  await saveConductorSettings(merged);
  return NextResponse.json({ settings: merged });
}
