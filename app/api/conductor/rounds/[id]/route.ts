import { NextResponse } from "next/server";
import { getRoundSlots } from "@/lib/conductor/selection";
import { requireAuthApi } from "@/lib/auth/dal";

export async function GET(_request: Request, ctx: RouteContext<"/api/conductor/rounds/[id]">) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const result = await getRoundSlots(Number(id));
  if (!result) return NextResponse.json({ error: "Round not found." }, { status: 404 });

  return NextResponse.json(result);
}
