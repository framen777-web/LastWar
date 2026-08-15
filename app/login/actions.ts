"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/auth/roles";
import { getGeneralPassword } from "@/lib/settings";
import type { Member } from "@/lib/generated/prisma/client";

// A member with no password of their own can still log in via the general password
// (Setup -> Users) - except Admins, who must always have their own password, since the
// general password is shown in plain text to any admin and shouldn't grant the highest
// privilege level.
async function checkPassword(member: Member, password: string): Promise<boolean> {
  if (member.passwordHash) return verifyPassword(password, member.passwordHash);
  if (effectiveRole(member) === "ADMIN") return false;
  const generalPassword = await getGeneralPassword();
  return !!generalPassword && password === generalPassword;
}

export async function login(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  let member = name ? await prisma.member.findUnique({ where: { name } }) : null;
  if (!member && name) {
    const all = await prisma.member.findMany();
    member = all.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  const valid = !!member && member.isActive && (await checkPassword(member, password));
  if (!valid || !member) {
    redirect("/login?error=1");
  }

  await createSession(member.id);
  redirect("/");
}
