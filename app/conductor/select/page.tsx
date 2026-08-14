import { prisma } from "@/lib/db";
import { getConductorSettings } from "@/lib/conductor/settings";
import { requireRole } from "@/lib/auth/dal";
import { SelectClient } from "./SelectClient";

export default async function ConductorSelectPage() {
  const user = await requireRole(["ADMIN", "LEADER"]);
  const isAdmin = user.role === "ADMIN";

  const settings = await getConductorSettings();
  const latestWeek = await prisma.weeklyStat.findFirst({ orderBy: { weekNumber: "desc" }, select: { weekNumber: true } });
  const defaultStartWeek = latestWeek?.weekNumber ?? settings.fromWeek;
  const members = await prisma.member.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });

  return (
    <SelectClient
      isAdmin={isAdmin}
      defaultWeeksInCycle={settings.weeksPerSelect}
      defaultStartWeek={defaultStartWeek}
      members={members}
    />
  );
}
