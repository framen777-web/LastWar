import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
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

  const results = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const safeName = `${Date.now()}-${sanitizeFilename(file.name)}`;

    const blob = await put(safeName, buffer, {
      access: "public",
      contentType: file.type || "image/png",
    });

    const result = await runPipelineForImage({
      filename: blob.url,
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
