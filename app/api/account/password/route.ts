import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { getMinPasswordLength } from "@/lib/settings";

export async function PATCH(request: Request) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { currentPassword?: string; newPassword?: string };
  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";

  const member = await prisma.member.findUnique({ where: { id: gate.user.id } });
  if (!member?.passwordHash || !verifyPassword(currentPassword, member.passwordHash)) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const minPasswordLength = await getMinPasswordLength();
  if (newPassword.length < minPasswordLength) {
    return NextResponse.json({ error: `New password must be at least ${minPasswordLength} characters.` }, { status: 400 });
  }

  await prisma.member.update({ where: { id: gate.user.id }, data: { passwordHash: hashPassword(newPassword) } });
  return NextResponse.json({ ok: true });
}
