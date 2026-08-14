import { NextResponse } from "next/server";
import { recalculateSelectionPoints } from "@/lib/conductor/points";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const result = await recalculateSelectionPoints();
  return NextResponse.json(result);
}
