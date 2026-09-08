import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { listPendingBatches } from "@/lib/verify/service";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const batches = await listPendingBatches();
  return NextResponse.json({ batches });
}
