import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { getSquadReview, getHqReview, acknowledgeIssue } from "@/lib/verify/service";

export async function GET(_request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]/review">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const review = (await getSquadReview(categoryKey, Number(weekNumber))) ?? (await getHqReview(categoryKey, Number(weekNumber)));
  if (!review) return NextResponse.json({ error: "Batch not found, or this category isn't set up for review." }, { status: 404 });
  return NextResponse.json({ review });
}

export async function POST(request: Request, ctx: RouteContext<"/api/verify/[categoryKey]/[weekNumber]/review">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { categoryKey, weekNumber } = await ctx.params;
  const body = (await request.json()) as { memberName?: string; issueType?: string };
  if (!body.memberName || !body.issueType) {
    return NextResponse.json({ error: "memberName and issueType are required." }, { status: 400 });
  }

  await acknowledgeIssue(categoryKey, Number(weekNumber), body.memberName, body.issueType);
  return NextResponse.json({ ok: true });
}
