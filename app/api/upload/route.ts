import { NextResponse } from "next/server";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { runPipelineForImage } from "@/lib/pipeline/run";
import { requireAdminApi } from "@/lib/auth/dal";

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

  const uploadsDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadsDir, { recursive: true });

  const results = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = `${Date.now()}-${sanitizeFilename(file.name)}`;
    await writeFile(path.join(uploadsDir, safeName), buffer);

    const result = await runPipelineForImage({
      filename: `/uploads/${safeName}`,
      buffer,
      mimeType: file.type || "image/png",
      weekNumber,
    });
    results.push(result);
  }

  return NextResponse.json({ results });
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}
