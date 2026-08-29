import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/pivot/views/[id]">) {
  const auth = await requireAuthApi();
  if ("error" in auth) return auth.error;

  const { id } = await ctx.params;
  // Scoped to creatorId so one member can never delete another member's saved view via a
  // guessed id - deleteMany rather than delete so a non-matching id (wrong creator, or already
  // gone) is a silent no-op instead of a thrown "record not found."
  await prisma.pivotView.deleteMany({ where: { id: Number(id), creatorId: auth.user.id } });
  return NextResponse.json({ ok: true });
}
