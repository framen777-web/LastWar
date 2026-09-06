import { prisma } from "@/lib/db";
import { runPipelineForImage } from "@/lib/pipeline/run";

/**
 * Works through an ImportJob's queued items one at a time until either the whole job is
 * done (processedFiles has caught up to totalFiles), the job's own status has moved off
 * "processing" (cancelled elsewhere), deadlineMs is reached, or there's simply nothing
 * queued to do RIGHT NOW. That last case matters because items can still be arriving one
 * at a time from the browser's in-flight uploads (see app/api/import/[jobId]/items) - this
 * just returns rather than marking the job complete, and the next /items call (or the
 * resume cron, if the browser goes away mid-upload) picks it back up.
 *
 * Safe to call concurrently for the same job (e.g. two /items calls landing close
 * together, or a resume() cron tick overlapping an after() callback): each item is claimed
 * with a conditional update before being processed, so only one caller ever actually runs
 * the pipeline for a given item. Always re-fetches the image from its stored Blob URL
 * rather than assuming the caller still has the original bytes in memory - this function
 * may run in a completely different invocation than the one that registered the item.
 */
export async function processImportJob(jobId: number, deadlineMs: number): Promise<void> {
  while (true) {
    if (Date.now() > deadlineMs) return;

    const job = await prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "processing") return;

    if (job.processedFiles >= job.totalFiles) {
      await prisma.importJob.updateMany({ where: { id: jobId, status: "processing" }, data: { status: "completed" } });
      return;
    }

    const next = await prisma.importJobItem.findFirst({
      where: { importJobId: jobId, status: "queued" },
      orderBy: { id: "asc" },
    });
    if (!next) return;

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
}
