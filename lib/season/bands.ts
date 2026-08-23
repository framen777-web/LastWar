import type { MemberSeasonScore } from "./points";

export type BandAssignment = {
  memberId: number;
  rank: number; // 1-based
  bandOrder: number | null; // null = below every band
  boxesAwarded: number;
};

export type BandDistributionResult = {
  assignments: BandAssignment[];
  unallocatedBoxes: number; // leftover after the last band - nowhere left to carry to
};

/** Walks the ranked list in band order, splitting each band's box pool evenly across the
 *  commanders that actually fall in it, carrying any rounding remainder into the next band's
 *  pool. Commanders past the last band get bandOrder null / 0 boxes. */
export function distributeBands(
  ranked: MemberSeasonScore[],
  bands: { order: number; commanderCount: number; pctOfBoxes: number }[],
  totalBoxes: number
): BandDistributionResult {
  const sortedBands = [...bands].sort((a, b) => a.order - b.order);
  const assignments: BandAssignment[] = ranked.map((m, i) => ({
    memberId: m.memberId,
    rank: i + 1,
    bandOrder: null,
    boxesAwarded: 0,
  }));

  let cursor = 0;
  let carriedBoxes = 0;
  for (const band of sortedBands) {
    const membersInBand = assignments.slice(cursor, cursor + band.commanderCount);
    const bandPool = Math.floor((totalBoxes * band.pctOfBoxes) / 100) + carriedBoxes;
    const perMember = membersInBand.length > 0 ? Math.floor(bandPool / membersInBand.length) : 0;
    const remainder = bandPool - perMember * membersInBand.length;

    for (const a of membersInBand) {
      a.bandOrder = band.order;
      a.boxesAwarded = perMember;
    }

    carriedBoxes = remainder;
    cursor += band.commanderCount;
  }

  return { assignments, unallocatedBoxes: carriedBoxes };
}
