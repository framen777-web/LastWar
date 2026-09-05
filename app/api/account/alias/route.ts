import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";

// Deliberately plain ASCII, not \p{L} - the whole point of a login alias is to be
// something easy to type, unlike a screen name that might be in a non-Latin script.
const ALIAS_PATTERN = /^[A-Za-z0-9 _.-]{2,32}$/;

export async function PATCH(request: Request) {
  const gate = await requireAuthApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { loginAlias?: string };
  const loginAlias = typeof body.loginAlias === "string" ? body.loginAlias.trim() : "";

  if (loginAlias && !ALIAS_PATTERN.test(loginAlias)) {
    return NextResponse.json(
      { error: "Alias must be 2-32 plain characters: letters, numbers, spaces, underscores, dots, or hyphens." },
      { status: 400 }
    );
  }

  try {
    await prisma.member.update({
      where: { id: gate.user.id },
      data: { loginAlias: loginAlias || null },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "That alias is already taken." }, { status: 400 });
    }
    throw err;
  }

  return NextResponse.json({ loginAlias });
}
