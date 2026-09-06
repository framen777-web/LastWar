import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/dal";
import { processImportJob } from "@/lib/importJob";

export const maxDuration = 60;

// Two legitimate callers: (1) an external cron hitting this on a schedule with the shared
// secret below - the actual guarantee that a big import finishes even if nobody ever
// reopens the app; (2) the Upload page firing this once on mount under the admin's own
// session, as a faster nudge for the common "just reopened the app" case. Either way this
// only ever resumes items that are already sitting there "queued".
async function isAuthorized(request: Request): Promise<boolean> {
  const secret = process.env.IMPORT_RESUME_SECRET;
  const header = request.headers.get("authorization");
  if (secret && header === `Bearer ${secret}`) return true;

  const user = await getCurrentUser();
  return user?.role === "ADMIN";
}

export async function POST(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Not authorized." }, { status: 401 });
  }

  const stalled = await prisma.importJob.findMany({
    where: { status: "processing", items: { some: { status: "queued" } } },
    select: { id: true },
  });

  const deadline = Date.now() + 50_000;
  for (const job of stalled) {
    await processImportJob(job.id, deadline);
    if (Date.now() > deadline) break; // the next cron tick picks up whatever's left
  }

  return NextResponse.json({ resumedJobs: stalled.length });
}
