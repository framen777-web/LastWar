import { prisma } from "@/lib/db";
import { getConductorSettings } from "@/lib/conductor/settings";
import { getRankableCategories } from "@/lib/conductor/stats";
import { requireMenuAccess } from "@/lib/menuAccess";
import { SelectClient } from "./SelectClient";

export default async function ConductorSelectPage() {
  const user = await requireMenuAccess("conductor-select");
  const isAdmin = user.role === "ADMIN";

  const settings = await getConductorSettings();
  const latestWeek = await prisma.weeklyStat.findFirst({ orderBy: { weekNumber: "desc" }, select: { weekNumber: true } });
  const defaultStartWeek = latestWeek?.weekNumber ?? settings.fromWeek;
  const members = await prisma.member.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
  const categories = await getRankableCategories();

  return (
    <SelectClient
      isAdmin={isAdmin}
      defaultWeeksInCycle={settings.weeksPerSelect}
      defaultStartWeek={defaultStartWeek}
      members={members}
      categories={categories}
    />
  );
}
