import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";

const VALID_ROLES = ["ADMIN", "LEADER", "MEMBER"];

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const items = await prisma.menuItem.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({
    items: items.map((i) => ({
      key: i.key,
      label: i.label,
      href: i.href,
      parentKey: i.parentKey,
      roles: JSON.parse(i.roles) as string[],
    })),
  });
}

export async function PATCH(request: Request) {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as { key?: string; roles?: string[] };
  if (typeof body.key !== "string" || !Array.isArray(body.roles) || !body.roles.every((r) => VALID_ROLES.includes(r))) {
    return NextResponse.json({ error: "Invalid key or roles." }, { status: 400 });
  }

  const existing = await prisma.menuItem.findUnique({ where: { key: body.key } });
  if (!existing) {
    return NextResponse.json({ error: "Unknown menu item." }, { status: 404 });
  }

  await prisma.menuItem.update({ where: { key: body.key }, data: { roles: JSON.stringify(body.roles) } });
  return NextResponse.json({ ok: true });
}
