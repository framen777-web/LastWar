import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireRoleApi } from "@/lib/auth/dal";

const VALID_STATUSES = ["open", "in_progress", "resolved", "wont_fix"];

export async function PATCH(request: Request, ctx: RouteContext<"/api/feedback/[id]">) {
  const auth = await requireRoleApi(["ADMIN", "LEADER"]);
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  const body = (await request.json()) as { status?: string };
  if (!body.status || !VALID_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(", ")}.` }, { status: 400 });
  }

  const item = await prisma.feedbackItem.update({ where: { id: Number(id) }, data: { status: body.status } });
  return NextResponse.json({ item });
}
