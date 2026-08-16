import { NextResponse } from "next/server";
import { overrideSlot, overrideSlotRankCascade, rerollPassengerSlot } from "@/lib/conductor/selection";
import { requireAdminApi } from "@/lib/auth/dal";

export async function PATCH(request: Request, ctx: RouteContext<"/api/conductor/rounds/[id]/slots">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const body = (await request.json()) as {
    slotIndex?: number;
    role?: "conductor" | "passenger";
    memberId?: number;
    sourceRank?: number;
    sourceCategoryKey?: string | null;
    reroll?: boolean;
  };

  if (typeof body.slotIndex !== "number" || (body.role !== "conductor" && body.role !== "passenger")) {
    return NextResponse.json({ error: "slotIndex and role are required." }, { status: 400 });
  }

  if (body.role === "passenger" && body.reroll === true) {
    const result = await rerollPassengerSlot(Number(id), body.slotIndex);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ slot: result.slot });
  }

  if (body.memberId === undefined && body.sourceRank === undefined && body.sourceCategoryKey === undefined) {
    return NextResponse.json({ error: "Provide memberId, sourceRank, or sourceCategoryKey." }, { status: 400 });
  }

  // Changing a Passenger's rank cascades to every other slot sharing that same category -
  // a direct member pick, a field change, or a Conductor change, doesn't cascade, only this one does.
  if (body.role === "passenger" && body.sourceRank !== undefined && body.memberId === undefined && body.sourceCategoryKey === undefined) {
    const result = await overrideSlotRankCascade(Number(id), body.slotIndex, body.sourceRank);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    return NextResponse.json({ slots: result.slots });
  }

  const result = await overrideSlot(Number(id), body.slotIndex, body.role, {
    memberId: body.memberId,
    sourceRank: body.sourceRank,
    sourceCategoryKey: body.sourceCategoryKey,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ slot: result.slot });
}
