"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { getMinPasswordLength } from "@/lib/settings";

export async function setupAdmin(formData: FormData) {
  const adminCount = await prisma.member.count({ where: { role: "ADMIN" } });
  if (adminCount > 0) redirect("/login");

  const memberId = Number(formData.get("memberId"));
  const password = String(formData.get("password") ?? "");
  const minPasswordLength = await getMinPasswordLength();
  if (!memberId || password.length < minPasswordLength) {
    redirect("/setup-admin?error=1");
  }

  const member = await prisma.member.update({
    where: { id: memberId },
    data: { role: "ADMIN", passwordHash: hashPassword(password), isActive: true },
  });

  await createSession(member.id);
  redirect("/");
}
