import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { Season } from "@/lib/generated/prisma/client";

/** Loads a season and rejects if it's already finalized - shared by every route that edits
 *  a season's config (basics, category points, extra items, bands), mirroring the
 *  draft/confirmed lock ConductorRound already uses. */
export async function loadEditableSeason(seasonId: number): Promise<{ season: Season } | { error: NextResponse }> {
  const season = await prisma.season.findUnique({ where: { id: seasonId } });
  if (!season) return { error: NextResponse.json({ error: "Season not found." }, { status: 404 }) };
  if (season.status === "final") {
    return { error: NextResponse.json({ error: "This season is finalized - reopen it before editing." }, { status: 409 }) };
  }
  return { season };
}

export type RateFlatInput = { mode?: string; pointsPerUnit?: number | null; unitSize?: number | null; flatValue?: number | null };

/** Shared rate/flat validation for both SeasonCategoryPoints and SeasonExtraItem rows -
 *  same two shapes Category.conductorMode already uses. Returns an error message, or null
 *  if valid. */
export function validateRateFlat(input: RateFlatInput): string | null {
  if (input.mode !== "rate" && input.mode !== "flat") return "Mode must be 'rate' or 'flat'.";
  if (input.mode === "rate") {
    if (typeof input.pointsPerUnit !== "number" || !Number.isFinite(input.pointsPerUnit)) {
      return "Points per unit is required for rate mode.";
    }
    if (typeof input.unitSize !== "number" || !Number.isFinite(input.unitSize) || input.unitSize <= 0) {
      return "Unit size must be a number greater than 0 for rate mode.";
    }
  }
  if (input.mode === "flat") {
    if (typeof input.flatValue !== "number" || !Number.isFinite(input.flatValue)) {
      return "Flat value is required for flat mode.";
    }
  }
  return null;
}

/** Same as validateRateFlat, but mode null/undefined is itself valid - meaning "not configured
 *  for points mode" (SeasonExtraItem's points config is optional, since an item can be set up
 *  for positional mode only, points mode only, both, or neither). */
export function validateOptionalRateFlat(input: RateFlatInput): string | null {
  if (input.mode === undefined || input.mode === null) return null;
  return validateRateFlat(input);
}

/** Weight validation for both SeasonCategoryWeight and SeasonExtraItem.weight - just needs to be
 *  a finite number; unlike rate/flat there's no shape to check, and nothing enforces weights
 *  summing to any particular total beyond the Setup UI's own soft warning. */
export function validateWeight(weight: unknown): string | null {
  if (typeof weight !== "number" || !Number.isFinite(weight)) return "Weight must be a number.";
  return null;
}
