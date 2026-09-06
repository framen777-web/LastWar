import { prisma } from "@/lib/db";
import { runPipelineForImage } from "@/lib/pipeline/run";

/**
 * Works through an ImportJob's queued items one at a time until either the job has none
 * left, the job's own status has moved off "processing" (cancelled elsewhere), or
 * deadlineMs is reached - whichever comes first. Safe to call concurrently for the same
 * job (e.g. an after() callback and a resume() cron tick overlapping): each item is
 * claimed with a conditional update before being processed, so only one caller ever
 * actually runs the pipeline for a given item.
 *
 * Always re-fetches the image from its stored Blob URL rather than assuming the caller
 * still has the original bytes in memory - this function may run in a completely
 * different invocation than the one that received the upload.
 */
export async function processImportJob(jobId: number, deadlineMs: number): Promise<void> {
  while (true) {
    if (Date.now() > deadlineMs) return;

    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "processing") return;

    const next = await prisma.importJobItem.findFirst({
      where: { importJobId: jobId, status: "queued" },
      orderBy: { order: "asc" },
    });
    if (!next) break;

    const claimed = await prisma.importJobItem.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "processing" },
    });
    if (claimed.count === 0) continue; // another invocation already claimed it

    try {
      const res = await fetch(next.blobUrl);
      if (!res.ok) throw new Error(`Could not re-fetch staged image from Blob (HTTP ${res.status})`);
      const buffer = Buffer.from(await res.arrayBuffer());

      const result = await runPipelineForImage({
        filename: next.blobUrl,
        buffer,
        mimeType: next.mimeType,
        weekNumber: job.weekNumber,
      });

      await prisma.importJobItem.update({
        where: { id: next.id },
        data: {
          status: "done",
          categoryKey: result.categoryKey,
          confidence: result.confidence,
          resultStatus: result.status,
          errorMessage: result.message ?? null,
        },
      });
    } catch (err) {
      await prisma.importJobItem.update({
        where: { id: next.id },
        data: { status: "done", resultStatus: "error", errorMessage: err instanceof Error ? err.message : String(err) },
      });
    }

    await prisma.importJob.update({ where: { id: jobId }, data: { processedFiles: { increment: 1 } } });
  }

  const remaining = await prisma.importJobItem.count({ where: { importJobId: jobId, status: { not: "done" } } });
  if (remaining === 0) {
    await prisma.importJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "completed" } });
  }
}
