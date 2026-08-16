import { NextResponse } from "next/server";
import { confirmRound, unconfirmRound } from "@/lib/conductor/selection";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(_request: Request, ctx: RouteContext<"/api/conductor/rounds/[id]/confirm">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const result = await confirmRound(Number(id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, ctx: RouteContext<"/api/conductor/rounds/[id]/confirm">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const result = await unconfirmRound(Number(id));
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json({ ok: true });
}
