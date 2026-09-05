import { NextResponse } from "next/server";
import { Prisma } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { getMinPasswordLength } from "@/lib/settings";
import { deleteMemberAndAllData } from "@/lib/pipeline/deleteMember";

const ALIAS_PATTERN = /^[A-Za-z0-9 _.-]{2,32}$/;

export async function PATCH(request: Request, ctx: RouteContext<"/api/users/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const memberId = Number(id);

  const current = await prisma.member.findUnique({ where: { id: memberId } });
  if (!current) {
    return NextResponse.json({ error: "Member not found." }, { status: 404 });
  }

  const body = (await request.json()) as {
    password?: string;
    role?: string | null;
    isActive?: boolean;
    nameConfirmed?: boolean;
    loginAlias?: string | null;
    name?: string;
  };
  const data: {
    passwordHash?: string;
    role?: string | null;
    isActive?: boolean;
    nameConfirmed?: boolean;
    loginAlias?: string | null;
    name?: string;
    aliases?: string;
  } = {};

  if (typeof body.password === "string" && body.password.length > 0) {
    const minPasswordLength = await getMinPasswordLength();
    if (body.password.length < minPasswordLength) {
      return NextResponse.json({ error: `Password must be at least ${minPasswordLength} characters.` }, { status: 400 });
    }
    data.passwordHash = hashPassword(body.password);
  }

  if (body.role !== undefined) {
    if (body.role !== null && body.role !== "ADMIN" && body.role !== "LEADER" && body.role !== "MEMBER") {
      return NextResponse.json({ error: "Invalid role." }, { status: 400 });
    }
    data.role = body.role;
  }

  if (body.isActive !== undefined) {
    data.isActive = body.isActive;
  }

  if (typeof body.nameConfirmed === "boolean") data.nameConfirmed = body.nameConfirmed;

  if (body.loginAlias !== undefined) {
    const alias = (body.loginAlias ?? "").trim();
    if (alias && !ALIAS_PATTERN.test(alias)) {
      return NextResponse.json(
        { error: "Alias must be 2-32 plain characters: letters, numbers, spaces, underscores, dots, or hyphens." },
        { status: 400 }
      );
    }
    data.loginAlias = alias || null;
  }

  if (typeof body.name === "string") {
    const newName = body.name.trim();
    if (!newName) {
      return NextResponse.json({ error: "Name cannot be empty." }, { status: 400 });
    }
    if (newName !== current.name) {
      const existingAliases = current.aliases
        ? current.aliases.split(",").map((a) => a.trim()).filter(Boolean)
        : [];
      if (!existingAliases.some((a) => a.toLowerCase() === current.name.toLowerCase())) {
        existingAliases.push(current.name);
      }
      data.name = newName;
      data.aliases = existingAliases.join(",");
    }
  }

  // Guardrail: never leave zero active admins (mirrors spec §11 "Last admin").
  const losingAdmin =
    current.role === "ADMIN" &&
    current.isActive &&
    ((body.role !== undefined && body.role !== "ADMIN") || body.isActive === false);

  if (losingAdmin) {
    const otherActiveAdmins = await prisma.member.count({
      where: { role: "ADMIN", isActive: true, id: { not: memberId } },
    });
    if (otherActiveAdmins === 0) {
      return NextResponse.json({ error: "Can't remove the last active admin." }, { status: 400 });
    }
  }

  try {
    const updated = await prisma.member.update({ where: { id: memberId }, data });
    return NextResponse.json({ ok: true, id: updated.id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = err.meta?.target;
      const onNameField = Array.isArray(target) && target.includes("name");
      return NextResponse.json(
        { error: onNameField ? "Another member already has that name." : "That alias is already taken." },
        { status: 400 }
      );
    }
    throw err;
  }
}

// Deliberately narrow - this rejects a bogus auto-created ("New") name, not a general
// delete-any-member button. A confirmed member already has Merge (combines, preserves
// history) and the Active toggle (hides, preserves history); neither throws data away,
// and this route isn't adding a way to do that to a real member.
export async function DELETE(_request: Request, ctx: RouteContext<"/api/users/[id]">) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  const memberId = Number(id);

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  if (member.nameConfirmed) {
    return NextResponse.json(
      { error: `Only unconfirmed ("New") members can be rejected this way. Merge or deactivate a confirmed member instead.` },
      { status: 400 }
    );
  }

  await deleteMemberAndAllData(memberId);
  return NextResponse.json({ ok: true });
}
