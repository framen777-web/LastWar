import { prisma } from "@/lib/db";

const BOTTOM_WEEKS_KEY = "r1BottomWeeksWindow";
export const DEFAULT_BOTTOM_WEEKS_WINDOW = 5;

async function getGlobalDefault(): Promise<number> {
  const setting = await prisma.setting.findUnique({ where: { key: BOTTOM_WEEKS_KEY } });
  const n = setting ? Number(setting.value) : NaN;
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_BOTTOM_WEEKS_WINDOW;
}

/**
 * Resolves the bottom-panel window length for one report week, pinning it the first time
 * it's resolved (or whenever explicitly overridden) so a later change to the global default
 * never silently changes an already-generated week.
 */
export async function resolveBottomWeeksWindow(weekNumber: number, override?: number): Promise<number> {
  const existing = await prisma.r1WeekSettings.findUnique({ where: { weekNumber } });
  const resolved = override ?? existing?.bottomWeeksWindow ?? (await getGlobalDefault());

  if (!existing || override !== undefined) {
    await prisma.r1WeekSettings.upsert({
      where: { weekNumber },
      update: { bottomWeeksWindow: resolved },
      create: { weekNumber, bottomWeeksWindow: resolved },
    });
  }
  return resolved;
}
