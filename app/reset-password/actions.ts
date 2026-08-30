"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { decodeResetToken, verifyResetToken } from "@/lib/auth/resetToken";
import { hashPassword } from "@/lib/auth/password";
import { getMinPasswordLength } from "@/lib/settings";

export async function resetPassword(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");

  const memberId = await decodeResetToken(token);
  const member = memberId ? await prisma.member.findUnique({ where: { id: memberId } }) : null;
  const minPasswordLength = await getMinPasswordLength();

  if (!member || !member.isActive || !(await verifyResetToken(token, member)) || password.length < minPasswordLength) {
    redirect(`/reset-password?token=${encodeURIComponent(token)}&error=1`);
  }

  await prisma.member.update({ where: { id: member.id }, data: { passwordHash: hashPassword(password) } });
  redirect("/login");
}
