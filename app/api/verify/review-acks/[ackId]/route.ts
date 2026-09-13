import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { unacknowledgeIssue } from "@/lib/verify/service";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/verify/review-acks/[ackId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { ackId } = await ctx.params;
  await unacknowledgeIssue(Number(ackId));
  return NextResponse.json({ ok: true });
}
