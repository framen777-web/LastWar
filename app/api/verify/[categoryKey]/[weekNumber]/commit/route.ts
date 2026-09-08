import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { commitBatch } from "@/lib/verify/service";

export async function POST(request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]/commit">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { acknowledgeVariance?: boolean };

  try {
    await commitBatch(categoryKey, Number(weekNumber), body.acknowledgeVariance ?? false);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
