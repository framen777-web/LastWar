export type SquadType = "tank" | "air" | "missile" | "fourth";

export type RawSquadValue = { type?: SquadType; value: number };

export type ResolvedSquadMember = {
  member_name: string;
  air?: number;
  tank?: number;
  missile?: number;
  fourth?: number;
  needsReview: boolean;
};

// A member's message may label its numbers with a troop-type letter (A/M/T/L), or not,
// or a mix of both. Labeled numbers go straight to their slot. Any unlabeled numbers -
// whether the message had zero labels or just some - fill the remaining open slots in
// this fixed order, in the order they appeared in the message. A member needs at least 3
// of the 4 slots resolved to be trusted; fewer than that is flagged for a person to
// recheck the source screenshot before confirming (see app/review/ReviewClient.tsx).
const FIXED_ORDER: SquadType[] = ["tank", "air", "missile", "fourth"];

export function resolveSquadMember(memberName: string, values: RawSquadValue[]): ResolvedSquadMember {
  const result: Partial<Record<SquadType, number>> = {};

  for (const v of values) {
    if (v.type) result[v.type] = v.value;
  }

  const openSlots = FIXED_ORDER.filter((slot) => result[slot] === undefined);
  const unlabeled = values.filter((v) => !v.type);
  unlabeled.forEach((v, i) => {
    const slot = openSlots[i];
    if (slot) result[slot] = v.value;
  });

  const resolvedCount = FIXED_ORDER.filter((slot) => result[slot] !== undefined).length;

  return { member_name: memberName, ...result, needsReview: resolvedCount < 3 };
}
