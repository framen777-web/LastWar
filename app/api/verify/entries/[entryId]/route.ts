import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";
import { deleteManualEntry } from "@/lib/verify/service";

export async function DELETE(_request: Request, ctx: RouteContext<"/api/verify/entries/[entryId]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { entryId } = await ctx.params;
  await deleteManualEntry(Number(entryId));
  return NextResponse.json({ ok: true });
}
