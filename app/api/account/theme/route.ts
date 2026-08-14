import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";
import { isValidTheme } from "@/lib/theme";

export async function PATCH(request: Request) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { theme?: string };
  if (typeof body.theme !== "string" || !isValidTheme(body.theme)) {
    return NextResponse.json({ error: "Invalid theme." }, { status: 400 });
  }

  await prisma.member.update({ where: { id: gate.user.id }, data: { theme: body.theme } });
  return NextResponse.json({ theme: body.theme });
}
