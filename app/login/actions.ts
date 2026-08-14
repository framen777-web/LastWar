"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

export async function login(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  let member = name ? await prisma.member.findUnique({ where: { name } }) : null;
  if (!member && name) {
    const all = await prisma.member.findMany();
    member = all.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  const valid = !!member?.passwordHash && member.isActive && verifyPassword(password, member.passwordHash);
  if (!valid || !member) {
    redirect("/login?error=1");
  }

  await createSession(member.id);
  redirect("/");
}
