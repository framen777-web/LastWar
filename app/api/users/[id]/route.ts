import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { hashPassword } from "@/lib/auth/password";
import { getMinPasswordLength } from "@/lib/settings";
import { deleteMemberAndAllData } from "@/lib/pipeline/deleteMember";

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
  };
  const data: { passwordHash?: string; role?: string | null; isActive?: boolean; nameConfirmed?: boolean } = {};

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

  const updated = await prisma.member.update({ where: { id: memberId }, data });
  return NextResponse.json({ ok: true, id: updated.id });
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
