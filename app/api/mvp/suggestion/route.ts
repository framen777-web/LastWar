import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { memberId?: number; weekNumber?: number; value?: string | null };

  if (typeof body.memberId !== "number" || typeof body.weekNumber !== "number") {
    return NextResponse.json({ error: "memberId and weekNumber are required." }, { status: 400 });
  }

  const value = body.value === "Promote" || body.value === "Watch" ? body.value : null;

  const suggestion = await prisma.suggestion.upsert({
    where: { memberId_weekNumber: { memberId: body.memberId, weekNumber: body.weekNumber } },
    update: { value },
    create: { memberId: body.memberId, weekNumber: body.weekNumber, value },
  });

  return NextResponse.json({ suggestion });
}
