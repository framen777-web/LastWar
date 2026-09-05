import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function GET(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;

  const extractions = await prisma.rawExtraction.findMany({
    where: statuses ? { status: { in: statuses } } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    extractions: extractions.map((ex) => ({ ...ex, parsed: safeParse(ex.rawJson) })),
  });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
