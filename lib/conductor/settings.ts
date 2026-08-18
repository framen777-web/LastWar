import { prisma } from "@/lib/db";

const SETTING_KEY = "conductorSettings";

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type WeekdayRule = { categoryKey: string; rank: number } | { random: true };

export type ConductorSettings = {
  fromWeek: number;
  weeksPerSelect: number;
  allowDuplicatePassengers: boolean;
  weekdayRules: Record<Weekday, WeekdayRule>;
};

// Every day defaults to Random until an admin points it at a category - safer than
// guessing a category key that might not exist yet on a fresh install.
export const DEFAULT_CONDUCTOR_SETTINGS: ConductorSettings = {
  fromWeek: 1,
  weeksPerSelect: 1,
  allowDuplicatePassengers: false,
  weekdayRules: {
    monday: { random: true },
    tuesday: { random: true },
    wednesday: { random: true },
    thursday: { random: true },
    friday: { random: true },
    saturday: { random: true },
    sunday: { random: true },
  },
};

export function isRandomRule(rule: WeekdayRule): rule is { random: true } {
  return "random" in rule && rule.random === true;
}

export async function getConductorSettings(): Promise<ConductorSettings> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) return DEFAULT_CONDUCTOR_SETTINGS;
  try {
    const parsed = JSON.parse(setting.value);
    return {
      ...DEFAULT_CONDUCTOR_SETTINGS,
      ...parsed,
      weekdayRules: { ...DEFAULT_CONDUCTOR_SETTINGS.weekdayRules, ...(parsed.weekdayRules ?? {}) },
    };
  } catch {
    return DEFAULT_CONDUCTOR_SETTINGS;
  }
}

export async function saveConductorSettings(settings: ConductorSettings): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(settings) },
    create: { key: SETTING_KEY, value: JSON.stringify(settings) },
  });
}
