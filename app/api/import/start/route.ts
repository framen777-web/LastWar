import { NextResponse, after } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { processImportJob } from "@/lib/importJob";

export const maxDuration = 60;

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const formData = await request.formData();
  const weekNumber = Number(formData.get("weekNumber"));
  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "Invalid weekNumber" }, { status: 400 });
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: { weekNumber, status: "processing", totalFiles: files.length },
  });

  const items = await Promise.all(
    files.map(async (file, order) => {
      const buffer = Buffer.from(await file.arrayBuffer());
      const safeName = `${Date.now()}-${order}-${sanitizeFilename(file.name)}`;
      const blob = await put(safeName, buffer, { access: "public", contentType: file.type || "image/png" });
      return {
        importJobId: job.id,
        order,
        filename: file.name,
        blobUrl: blob.url,
        mimeType: file.type || "image/png",
        status: "queued" as const,
      };
    })
  );
  await prisma.importJobItem.createMany({ data: items });

  // Runs after this response has already gone back to the browser - this is what makes
  // the import keep going regardless of what the browser tab does next. If this
  // invocation's own maxDuration runs out mid-batch, /api/import/resume (an external cron
  // plus the Upload page's on-mount nudge) picks up anything still "queued".
  after(() => processImportJob(job.id, Date.now() + 50_000));

  return NextResponse.json({ jobId: job.id, totalFiles: files.length });
}
