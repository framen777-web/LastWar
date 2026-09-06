import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET(_request: Request, ctx: RouteContext<"/api/import/[jobId]/status">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const jobId = Number((await ctx.params).jobId);
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    include: { items: { orderBy: { order: "asc" } } },
  });
  if (!job) return NextResponse.json({ error: "Import job not found" }, { status: 404 });

  return NextResponse.json({
    jobId: job.id,
    status: job.status,
    totalFiles: job.totalFiles,
    processedFiles: job.processedFiles,
    items: job.items.map((i) => ({
      filename: i.filename,
      status: i.status,
      categoryKey: i.categoryKey,
      confidence: i.confidence,
      resultStatus: i.resultStatus,
      errorMessage: i.errorMessage,
    })),
  });
}
