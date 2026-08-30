"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { createResetToken } from "@/lib/auth/resetToken";
import { sendPasswordResetEmail } from "@/lib/email/passwordReset";

export async function requestPasswordReset(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();

  let member = name ? await prisma.member.findUnique({ where: { name } }) : null;
  if (!member && name) {
    const all = await prisma.member.findMany();
    member = all.find((m) => m.name.toLowerCase() === name.toLowerCase()) ?? null;
  }

  if (member?.isActive && member.contactEmail) {
    const token = await createResetToken(member);
    const baseUrl = process.env.APP_BASE_URL ?? "http://localhost:3000";
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await sendPasswordResetEmail(member.contactEmail, member.name, resetUrl);
  }

  redirect("/forgot-password?submitted=1");
}
