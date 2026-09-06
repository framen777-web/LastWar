import { NextResponse, after } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { processImportJob } from "@/lib/importJob";

export const maxDuration = 60;

export async function POST(request: Request, ctx: RouteContext<"/api/import/[jobId]/items">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const jobId = Number((await ctx.params).jobId);
  const body = (await request.json()) as { filename?: string; blobUrl?: string; mimeType?: string };
  if (!body.filename || !body.blobUrl || !body.mimeType) {
    return NextResponse.json({ error: "filename, blobUrl and mimeType are required" }, { status: 400 });
  }

  await prisma.importJobItem.create({
    data: { importJobId: jobId, filename: body.filename, blobUrl: body.blobUrl, mimeType: body.mimeType, status: "queued" },
  });

  // Same reasoning as /api/import/start had before: runs after this response is already
  // sent, so it doesn't depend on the browser tab. Called once per file as uploads finish,
  // so the first few files are already being processed while the rest are still uploading.
  after(() => processImportJob(jobId, Date.now() + 50_000));

  return NextResponse.json({ ok: true });
}
