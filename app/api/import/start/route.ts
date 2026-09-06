import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function POST(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { weekNumber?: number; totalFiles?: number };
  const weekNumber = Number(body.weekNumber);
  const totalFiles = Number(body.totalFiles);

  if (!Number.isInteger(weekNumber) || weekNumber < 1) {
    return NextResponse.json({ error: "Invalid weekNumber" }, { status: 400 });
  }
  if (!Number.isInteger(totalFiles) || totalFiles < 1) {
    return NextResponse.json({ error: "Invalid totalFiles" }, { status: 400 });
  }

  const job = await prisma.importJob.create({
    data: { weekNumber, status: "processing", totalFiles },
  });

  return NextResponse.json({ jobId: job.id });
}
