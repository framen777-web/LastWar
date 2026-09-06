import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(_request: Request, ctx: RouteContext<"/api/import/[jobId]/cancel">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const jobId = Number((await ctx.params).jobId);

  // processImportJob re-checks ImportJob.status on every loop iteration (not just once at
  // the start), so flipping this to "cancelled" actually stops further processing between
  // items - it doesn't just relabel the row.
  await prisma.importJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "cancelled" } });
  await prisma.importJobItem.updateMany({
    where: { importJobId: jobId, status: "queued" },
    data: { status: "done", resultStatus: "error", errorMessage: "Cancelled" },
  });

  return NextResponse.json({ ok: true });
}
