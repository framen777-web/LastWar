import { prisma } from "@/lib/db";
import type { Weights } from "./mvp";

const SETTING_KEY = "mvpWeights";

export const DEFAULT_WEIGHTS: Weights = {
  vs: 0.4,
  ds: 0.2,
  hqMover: 0.05,
  donations: 0.2,
  kills: 0.05,
  squad: 0.05,
  canyonStorm: 0.05,
  zombieSiege: 0,
  allianceExercise: 0,
};

export async function getWeights(): Promise<Weights> {
  const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
  if (!setting) return DEFAULT_WEIGHTS;
  try {
    return { ...DEFAULT_WEIGHTS, ...JSON.parse(setting.value) };
  } catch {
    return DEFAULT_WEIGHTS;
  }
}

export async function saveWeights(weights: Weights): Promise<void> {
  await prisma.setting.upsert({
    where: { key: SETTING_KEY },
    update: { value: JSON.stringify(weights) },
    create: { key: SETTING_KEY, value: JSON.stringify(weights) },
  });
}
