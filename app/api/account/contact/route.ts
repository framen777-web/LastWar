import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";

export async function PATCH(request: Request) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { whatsapp?: string; email?: string };
  const whatsapp = typeof body.whatsapp === "string" ? body.whatsapp.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "That doesn't look like a valid email address." }, { status: 400 });
  }

  await prisma.member.update({
    where: { id: gate.user.id },
    data: { contactWhatsapp: whatsapp || null, contactEmail: email || null },
  });

  return NextResponse.json({ whatsapp, email });
}
