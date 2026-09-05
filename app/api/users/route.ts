import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminApi } from "@/lib/auth/dal";
import { effectiveRole } from "@/lib/auth/roles";
import { syncMemberActiveStatus } from "@/lib/members/activeSync";

export async function GET() {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const { lastCompletedWeek } = await syncMemberActiveStatus();
  const members = await prisma.member.findMany({ orderBy: { name: "asc" } });

  return NextResponse.json({
    lastCompletedWeek,
    users: members.map((m) => ({
      id: m.id,
      name: m.name,
      allianceRank: m.allianceRank,
      roleOverride: m.role,
      effectiveRole: effectiveRole(m),
      hasPassword: !!m.passwordHash,
      isActive: m.isActive,
      nameConfirmed: m.nameConfirmed,
      loginAlias: m.loginAlias,
    })),
  });
}
