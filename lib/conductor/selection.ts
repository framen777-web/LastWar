import { prisma } from "@/lib/db";
import { computeStandings } from "./points";
import { getConductorCategoryWeekValues, type CategoryWeekValue } from "./stats";
import { getConductorSettings, isRandomRule, WEEKDAYS, type ConductorSettings, type Weekday } from "./settings";
import { getActiveMemberIdsForWeekWithFallback } from "@/lib/members/weekActivity";

export type DraftSlot = {
  slotIndex: number;
  weekday: Weekday;
  weekNumber: number;
  role: "conductor" | "passenger";
  memberId: number | null;
  memberName: string | null;
  pointsAtSelection: number | null;
  sourceCategoryKey: string | null;
  sourceRank: number | null;
  manualOverride: boolean;
  collision: boolean;
  collisionReason: string | null;
};

export function weekdayForSlot(slotIndex: number): Weekday {
  return WEEKDAYS[slotIndex % 7];
}

export function weekForSlot(slotIndex: number, startWeek: number): number {
  return startWeek + Math.floor(slotIndex / 7);
}

type LeaderboardEntry = { memberId: number; value: number };

function buildLeaderboard(
  members: { id: number }[],
  values: Map<string, CategoryWeekValue>,
  categoryKey: string,
  weekNumber: number
): LeaderboardEntry[] {
  return members
    .map((m) => ({ memberId: m.id, value: values.get(`${m.id}:${weekNumber}:${categoryKey}`)?.value ?? null }))
    .filter((r): r is LeaderboardEntry => r.value !== null)
    .sort((a, b) => b.value - a.value);
}

/** Same as buildLeaderboard, but if a week has no data at all for this category yet (e.g. it
 * hasn't been reported yet), falls back to the most recent earlier week that does - so "rank
 * 3 in VS" for a not-yet-reported week resolves against the last real VS standings instead of
 * staying unassigned until that week's data shows up. */
function buildLeaderboardWithFallback(
  members: { id: number }[],
  values: Map<string, CategoryWeekValue>,
  categoryKey: string,
  weekNumber: number
): LeaderboardEntry[] {
  for (let w = weekNumber; w >= 1; w--) {
    const leaderboard = buildLeaderboard(members, values, categoryKey, w);
    if (leaderboard.length > 0) return leaderboard;
  }
  return [];
}

/**
 * Resolves one passenger slot's field+rank rule against that week's leaderboard, literally -
 * whoever is at that rank is the answer, every time, even if they're already used
 * elsewhere in the round. No walk-down, no availability check: a slot either has that
 * literal person or it has nobody (rank doesn't exist on that week's leaderboard).
 * Duplicate-use is detected and surfaced separately (see detectRoundCollision), not
 * avoided here - avoiding it silently is exactly what this function used to do and what
 * made a manual rank/field edit ripple into other slots unexpectedly.
 */
function resolvePassenger(
  leaderboard: LeaderboardEntry[],
  requestedRank: number
): { memberId: number | null; sourceRank: number | null; collision: boolean; collisionReason: string | null } {
  const requested = leaderboard[requestedRank - 1];
  if (!requested) {
    return { memberId: null, sourceRank: null, collision: true, collisionReason: `No member at rank ${requestedRank}.` };
  }
  return { memberId: requested.memberId, sourceRank: requestedRank, collision: false, collisionReason: null };
}

/**
 * A slot's collision is now something to detect and surface, not something resolution
 * silently avoids (see resolvePassenger's docs above). Checks, in order: no member
 * assigned; the same member as this exact day's other role (Conductor and Passenger can't
 * be the same person); and, for Passengers, the same member already used as Passenger
 * somewhere else in the round (only when allowDuplicatePassengers is off) - the same rule
 * confirmRound() already enforces at confirm time, surfaced here at draft time instead.
 */
function detectRoundCollision(
  slot: { slotIndex: number; role: "conductor" | "passenger"; memberId: number | null },
  allSelections: { slotIndex: number; role: string; memberId: number | null }[],
  allowDuplicatePassengers: boolean
): { collision: boolean; collisionReason: string | null } {
  if (slot.memberId === null) {
    return { collision: true, collisionReason: "No member assigned." };
  }

  const otherRoleSameDay = allSelections.find((s) => s.slotIndex === slot.slotIndex && s.role !== slot.role);
  if (otherRoleSameDay && otherRoleSameDay.memberId === slot.memberId) {
    return { collision: true, collisionReason: "Same member is Conductor and Passenger this day." };
  }

  if (slot.role === "passenger" && !allowDuplicatePassengers) {
    const otherPassenger = allSelections.find(
      (s) => s.role === "passenger" && s.slotIndex !== slot.slotIndex && s.memberId === slot.memberId
    );
    if (otherPassenger) {
      const weekday = weekdayForSlot(otherPassenger.slotIndex);
      const label = weekday.charAt(0).toUpperCase() + weekday.slice(1);
      return { collision: true, collisionReason: `Also Passenger on ${label}.` };
    }
  }

  return { collision: false, collisionReason: null };
}

/**
 * The specific "why" for a slot that never resolved to anyone, used whenever memberId is
 * null - detectRoundCollision's own null-member case is a generic fallback ("No member
 * assigned.") meant only for a duplicate-detection pass that's already been told to skip
 * unresolved slots (see generateDraft's second pass); every other caller needs the real
 * reason instead of that generic one.
 */
function unresolvedReason(role: "conductor" | "passenger", sourceCategoryKey: string | null, sourceRank: number | null): string {
  if (role === "conductor") return "No eligible member with data for this week.";
  if (sourceCategoryKey) return `No member at rank ${sourceRank ?? "?"}.`;
  return "No eligible member available for Random.";
}

async function loadContext(startWeek: number, slotCount: number) {
  const [settings, standings, categoryValues, members] = await Promise.all([
    getConductorSettings(),
    computeStandings(),
    getConductorCategoryWeekValues(),
    prisma.member.findMany({ where: { isActive: true } }),
  ]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));
  const weeksNeeded = new Set<number>();
  for (let i = 0; i < slotCount; i++) weeksNeeded.add(weekForSlot(i, startWeek));

  // Nobody without real data for a slot's own week is eligible for that slot, as either
  // Conductor or Passenger - having stayed "active" overall (points balance, isActive) isn't
  // enough on its own if they simply didn't report that specific week.
  const activeIdsByWeek = new Map<number, Set<number>>();
  await Promise.all(
    [...weeksNeeded].map(async (w) => {
      activeIdsByWeek.set(w, await getActiveMemberIdsForWeekWithFallback(w));
    })
  );

  return { settings, standings, categoryValues, members, memberNameById, weeksNeeded, activeIdsByWeek };
}

/** Generates and persists a new draft round: top-N conductors by balance, one passenger per day per the weekday rules. */
export async function generateDraft(weeksInCycle: number, startWeek: number): Promise<{ roundId: number; slots: DraftSlot[] }> {
  const slotCount = weeksInCycle * 7;
  const { settings, standings, categoryValues, members, memberNameById, activeIdsByWeek } = await loadContext(startWeek, slotCount);

  const slots: DraftSlot[] = [];
  const conductorByIndex = new Map<number, number>();
  const usedConductorIds = new Set<number>();

  for (let i = 0; i < slotCount; i++) {
    const weekNumber = weekForSlot(i, startWeek);
    const weekActiveIds = activeIdsByWeek.get(weekNumber)!;
    // Highest-balance member not already Conductor elsewhere in this round who also has real
    // data for this specific week - a high balance from earlier weeks doesn't carry someone
    // through a week they didn't report at all.
    const pick = standings.find((s) => !usedConductorIds.has(s.memberId) && weekActiveIds.has(s.memberId));
    slots.push({
      slotIndex: i,
      weekday: weekdayForSlot(i),
      weekNumber,
      role: "conductor",
      memberId: pick?.memberId ?? null,
      memberName: pick ? (memberNameById.get(pick.memberId) ?? pick.memberName) : null,
      pointsAtSelection: pick?.total ?? null,
      sourceCategoryKey: null,
      sourceRank: null,
      manualOverride: false,
      collision: !pick,
      collisionReason: pick ? null : "No eligible member with data for this week.",
    });
    if (pick) {
      conductorByIndex.set(i, pick.memberId);
      usedConductorIds.add(pick.memberId);
    }
  }

  const usedPassengerMemberIds = new Set<number>();
  const activeMemberIds = members.map((m) => m.id);

  for (let i = 0; i < slotCount; i++) {
    const weekday = weekdayForSlot(i);
    const weekNumber = weekForSlot(i, startWeek);
    const rule = settings.weekdayRules[weekday];
    const conductorMemberId = conductorByIndex.get(i) ?? null;
    const weekActiveIds = activeIdsByWeek.get(weekNumber)!;

    let result: { memberId: number | null; sourceRank: number | null; collision: boolean; collisionReason: string | null };
    let sourceCategoryKey: string | null = null;
    let requestedRank: number | null = null;

    if (isRandomRule(rule)) {
      // Random keeps trying to avoid an easily-avoidable duplicate (same as the explicit
      // Reroll action) - there's no field/rank an admin could manually re-target for a
      // Random slot the way there is for a category one, so this is the only chance to
      // sidestep an obvious collision before it needs a Reroll click to fix.
      const isAvailable = (candidateId: number) =>
        candidateId !== conductorMemberId &&
        weekActiveIds.has(candidateId) &&
        (settings.allowDuplicatePassengers || !usedPassengerMemberIds.has(candidateId));
      const pool = activeMemberIds.filter(isAvailable);
      result =
        pool.length > 0
          ? { memberId: pool[Math.floor(Math.random() * pool.length)], sourceRank: null, collision: false, collisionReason: null }
          : { memberId: null, sourceRank: null, collision: true, collisionReason: "No eligible member available for Random." };
    } else {
      // Every occurrence of a category always requests that weekday rule's own configured
      // rank, literally - two days both set to "VS rank 1" both request rank 1, and (unless
      // one is on a different week) will resolve to the same person. That's now surfaced as
      // a collision below, not silently spread apart.
      sourceCategoryKey = rule.categoryKey;
      requestedRank = rule.rank;
      const leaderboard = buildLeaderboardWithFallback(members, categoryValues, rule.categoryKey, weekNumber);
      result = resolvePassenger(leaderboard, requestedRank);
    }

    if (result.memberId !== null) usedPassengerMemberIds.add(result.memberId);

    slots.push({
      slotIndex: i,
      weekday,
      weekNumber,
      role: "passenger",
      memberId: result.memberId,
      memberName: result.memberId !== null ? (memberNameById.get(result.memberId) ?? null) : null,
      pointsAtSelection: null,
      // Keep the rule's own field even when nobody could be resolved for it (no data for
      // that week) - a collision should read "VS, no member found", not silently mislabel
      // the slot as Random.
      sourceCategoryKey,
      sourceRank: result.sourceRank ?? requestedRank,
      manualOverride: false,
      collision: result.collision,
      collisionReason: result.collisionReason,
    });
  }

  // Second pass, now that every slot in the round is known: flag duplicate use across
  // slots (same member twice as Passenger, or Conductor==Passenger the same day) - only for
  // slots that actually resolved to someone, so an unresolved slot keeps its more specific
  // "why" reason from above instead of a generic "No member assigned."
  for (const slot of slots) {
    if (slot.memberId === null) continue;
    const { collision, collisionReason } = detectRoundCollision(slot, slots, settings.allowDuplicatePassengers);
    slot.collision = collision;
    slot.collisionReason = collisionReason;
  }

  const round = await prisma.conductorRound.create({ data: { weeksInCycle, startWeek, status: "draft" } });
  await prisma.conductorSelection.createMany({
    data: slots.map((s) => ({
      roundId: round.id,
      memberId: s.memberId,
      role: s.role,
      slotIndex: s.slotIndex,
      weekNumber: s.weekNumber,
      pointsAtSelection: s.pointsAtSelection,
      sourceCategoryKey: s.sourceCategoryKey,
      sourceRank: s.sourceRank,
    })),
  });

  return { roundId: round.id, slots };
}

/**
 * Any Passenger slot still unresolved gets one more attempt every time the round is loaded
 * - not just at generation time - since the only thing that can still change afterward is
 * whether a week's data has since been imported (the literal rank now either exists on
 * that week's leaderboard or it doesn't; nothing about who's "already used" affects this
 * anymore). A slot the admin has manually touched is never re-picked out from under them;
 * it stays exactly as they left it. Random slots still avoid an easily-avoidable duplicate
 * on retry, same carve-out as generateDraft and Reroll.
 */
async function retryUnresolvedPassengers(round: { status: string; selections: { id: number; role: string; slotIndex: number; weekNumber: number; memberId: number | null; sourceCategoryKey: string | null; sourceRank: number | null; manualOverride: boolean }[] }): Promise<void> {
  if (round.status !== "draft") return;

  const pending = round.selections.filter((s) => s.role === "passenger" && s.memberId === null && !s.manualOverride);
  if (pending.length === 0) return;

  const [settings, categoryValues, activeMembers] = await Promise.all([
    getConductorSettings(),
    getConductorCategoryWeekValues(),
    prisma.member.findMany({ where: { isActive: true } }),
  ]);
  const activeMemberIds = activeMembers.map((m) => m.id);
  const conductorMemberBySlot = new Map(round.selections.filter((s) => s.role === "conductor").map((s) => [s.slotIndex, s.memberId]));
  const usedPassengerMemberIds = new Set(
    round.selections.filter((s) => s.role === "passenger" && s.memberId !== null).map((s) => s.memberId as number)
  );

  const updates: { id: number; memberId: number | null; sourceRank: number | null }[] = [];
  for (const s of pending) {
    let result: { memberId: number | null; sourceRank: number | null };
    if (s.sourceCategoryKey) {
      const leaderboard = buildLeaderboardWithFallback(activeMembers, categoryValues, s.sourceCategoryKey, s.weekNumber);
      const requestedRank = s.sourceRank ?? 1;
      result = resolvePassenger(leaderboard, requestedRank);
    } else {
      const weekActiveIds = await getActiveMemberIdsForWeekWithFallback(s.weekNumber);
      const isAvailable = (candidateId: number) =>
        candidateId !== conductorMemberBySlot.get(s.slotIndex) &&
        weekActiveIds.has(candidateId) &&
        (settings.allowDuplicatePassengers || !usedPassengerMemberIds.has(candidateId));
      const pool = activeMemberIds.filter(isAvailable);
      result = pool.length > 0 ? { memberId: pool[Math.floor(Math.random() * pool.length)], sourceRank: null } : { memberId: null, sourceRank: null };
    }

    if (result.memberId === null) continue;
    usedPassengerMemberIds.add(result.memberId);
    s.memberId = result.memberId;
    if (result.sourceRank !== null) s.sourceRank = result.sourceRank;
    updates.push({ id: s.id, memberId: result.memberId, sourceRank: s.sourceRank });
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map((u) => prisma.conductorSelection.update({ where: { id: u.id }, data: { memberId: u.memberId, sourceRank: u.sourceRank } }))
    );
  }
}

export async function getRoundSlots(roundId: number): Promise<{ round: { id: number; weeksInCycle: number; startWeek: number; status: string }; slots: DraftSlot[] } | null> {
  const round = await prisma.conductorRound.findUnique({ where: { id: roundId }, include: { selections: true } });
  if (!round) return null;

  await retryUnresolvedPassengers(round);

  const [members, settings] = await Promise.all([prisma.member.findMany(), getConductorSettings()]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  const slots: DraftSlot[] = round.selections
    .map((s) => {
      const { collision, collisionReason } =
        s.memberId === null
          ? { collision: true, collisionReason: unresolvedReason(s.role as "conductor" | "passenger", s.sourceCategoryKey, s.sourceRank) }
          : detectRoundCollision(
              { slotIndex: s.slotIndex, role: s.role as "conductor" | "passenger", memberId: s.memberId },
              round.selections,
              settings.allowDuplicatePassengers
            );
      return {
        slotIndex: s.slotIndex,
        weekday: weekdayForSlot(s.slotIndex),
        weekNumber: s.weekNumber,
        role: s.role as "conductor" | "passenger",
        memberId: s.memberId,
        memberName: s.memberId !== null ? (memberNameById.get(s.memberId) ?? null) : null,
        pointsAtSelection: s.pointsAtSelection,
        sourceCategoryKey: s.sourceCategoryKey,
        sourceRank: s.sourceRank,
        manualOverride: s.manualOverride,
        collision,
        collisionReason,
      };
    })
    .sort((a, b) => a.slotIndex - b.slotIndex || a.role.localeCompare(b.role));

  return { round: { id: round.id, weeksInCycle: round.weeksInCycle, startWeek: round.startWeek, status: round.status }, slots };
}

/** Overrides one slot: either assign a specific member directly, or (Passenger only) re-resolve from a new rank. */
export async function overrideSlot(
  roundId: number,
  slotIndex: number,
  role: "conductor" | "passenger",
  input: { memberId?: number; sourceRank?: number; sourceCategoryKey?: string | null }
): Promise<{ ok: true; slot: DraftSlot } | { ok: false; error: string }> {
  const round = await prisma.conductorRound.findUnique({ where: { id: roundId }, include: { selections: true } });
  if (!round) return { ok: false, error: "Round not found." };
  if (round.status !== "draft") return { ok: false, error: "Only draft rounds can be edited." };

  const existing = round.selections.find((s) => s.slotIndex === slotIndex && s.role === role);
  if (!existing) return { ok: false, error: "Slot not found." };

  const [members, settings] = await Promise.all([
    prisma.member.findMany({ where: { isActive: true } }),
    getConductorSettings(),
  ]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  let memberId: number | null = existing.memberId;
  let pointsAtSelection: number | null = existing.pointsAtSelection;
  let sourceCategoryKey: string | null = existing.sourceCategoryKey;
  let sourceRank: number | null = existing.sourceRank;

  if (input.memberId !== undefined) {
    memberId = input.memberId;
    if (role === "conductor") {
      const standings = await computeStandings();
      pointsAtSelection = standings.find((s) => s.memberId === memberId)?.total ?? 0;
    } else {
      sourceCategoryKey = null;
      sourceRank = null;
    }
  } else if (input.sourceCategoryKey !== undefined && role === "passenger") {
    if (input.sourceCategoryKey === null) {
      // Switching to Random still avoids an easily-avoidable duplicate, same carve-out as
      // generateDraft/Reroll - there's no field/rank to manually re-target a Random pick.
      const weekActiveIds = await getActiveMemberIdsForWeekWithFallback(existing.weekNumber);
      const conductorSlot = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "conductor");
      const usedElsewhere = new Set(
        round.selections
          .filter((s) => s.role === "passenger" && s.slotIndex !== slotIndex && s.memberId !== null)
          .map((s) => s.memberId as number)
      );
      const isAvailable = (candidateId: number) =>
        candidateId !== conductorSlot?.memberId &&
        weekActiveIds.has(candidateId) &&
        (settings.allowDuplicatePassengers || !usedElsewhere.has(candidateId));
      const pool = members.map((m) => m.id).filter(isAvailable);
      memberId = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
      sourceCategoryKey = null;
      sourceRank = null;
    } else {
      // Literal resolution: whoever is at this rank on the new field's leaderboard, full
      // stop - a resulting duplicate is reported (see detectRoundCollision), not avoided.
      const categoryValues = await getConductorCategoryWeekValues();
      const leaderboard = buildLeaderboardWithFallback(members, categoryValues, input.sourceCategoryKey, existing.weekNumber);
      const requestedRank = existing.sourceRank ?? 1;
      const result = resolvePassenger(leaderboard, requestedRank);
      sourceCategoryKey = input.sourceCategoryKey;
      memberId = result.memberId;
      sourceRank = result.sourceRank ?? requestedRank;
    }
  } else if (input.sourceRank !== undefined && role === "passenger" && existing.sourceCategoryKey) {
    const categoryValues = await getConductorCategoryWeekValues();
    const leaderboard = buildLeaderboardWithFallback(members, categoryValues, existing.sourceCategoryKey, existing.weekNumber);
    const result = resolvePassenger(leaderboard, input.sourceRank);
    memberId = result.memberId;
    sourceRank = result.sourceRank ?? input.sourceRank;
  }

  const updated = await prisma.conductorSelection.update({
    where: { id: existing.id },
    data: { memberId, pointsAtSelection, sourceCategoryKey, sourceRank, manualOverride: true },
  });

  const otherSelections = round.selections.map((s) => (s.id === updated.id ? updated : s));
  const { collision, collisionReason } =
    updated.memberId === null
      ? { collision: true, collisionReason: unresolvedReason(updated.role as "conductor" | "passenger", updated.sourceCategoryKey, updated.sourceRank) }
      : detectRoundCollision(
          { slotIndex: updated.slotIndex, role: updated.role as "conductor" | "passenger", memberId: updated.memberId },
          otherSelections,
          settings.allowDuplicatePassengers
        );

  return {
    ok: true,
    slot: {
      slotIndex: updated.slotIndex,
      weekday: weekdayForSlot(updated.slotIndex),
      weekNumber: updated.weekNumber,
      role: updated.role as "conductor" | "passenger",
      memberId: updated.memberId,
      memberName: updated.memberId !== null ? (memberNameById.get(updated.memberId) ?? null) : null,
      pointsAtSelection: updated.pointsAtSelection,
      sourceCategoryKey: updated.sourceCategoryKey,
      sourceRank: updated.sourceRank,
      manualOverride: updated.manualOverride,
      collision,
      collisionReason,
    },
  };
}

/** Re-randomizes one Random-rule Passenger slot only, leaving every other slot in the round untouched. */
export async function rerollPassengerSlot(
  roundId: number,
  slotIndex: number
): Promise<{ ok: true; slot: DraftSlot } | { ok: false; error: string }> {
  const round = await prisma.conductorRound.findUnique({ where: { id: roundId }, include: { selections: true } });
  if (!round) return { ok: false, error: "Round not found." };
  if (round.status !== "draft") return { ok: false, error: "Only draft rounds can be edited." };

  const existing = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "passenger");
  if (!existing) return { ok: false, error: "Slot not found." };
  if (existing.sourceCategoryKey) return { ok: false, error: "Only Random slots can be rerolled - this one is field-based." };

  const [settings, members, weekActiveIds] = await Promise.all([
    getConductorSettings(),
    prisma.member.findMany({ where: { isActive: true } }),
    getActiveMemberIdsForWeekWithFallback(existing.weekNumber),
  ]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  const conductorSlot = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "conductor");
  const usedElsewhere = new Set(
    round.selections
      .filter((s) => s.role === "passenger" && s.slotIndex !== slotIndex && s.memberId !== null)
      .map((s) => s.memberId as number)
  );
  const isAvailable = (candidateId: number) =>
    candidateId !== conductorSlot?.memberId &&
    weekActiveIds.has(candidateId) &&
    (settings.allowDuplicatePassengers || !usedElsewhere.has(candidateId));

  const pool = members.map((m) => m.id).filter(isAvailable);
  // Prefer a genuinely different pick from what's already there, when another option exists.
  const freshPool = pool.filter((id) => id !== existing.memberId);
  const finalPool = freshPool.length > 0 ? freshPool : pool;
  const memberId = finalPool.length > 0 ? finalPool[Math.floor(Math.random() * finalPool.length)] : null;

  const updated = await prisma.conductorSelection.update({
    where: { id: existing.id },
    data: { memberId, manualOverride: true },
  });

  return {
    ok: true,
    slot: {
      slotIndex: updated.slotIndex,
      weekday: weekdayForSlot(updated.slotIndex),
      weekNumber: updated.weekNumber,
      role: "passenger",
      memberId: updated.memberId,
      memberName: updated.memberId !== null ? (memberNameById.get(updated.memberId) ?? null) : null,
      pointsAtSelection: updated.pointsAtSelection,
      sourceCategoryKey: updated.sourceCategoryKey,
      sourceRank: updated.sourceRank,
      manualOverride: updated.manualOverride,
      collision: updated.memberId === null,
      collisionReason: updated.memberId === null ? "No eligible member available for Random." : null,
    },
  };
}

/** Re-validates the hard rules against the round's current (possibly overridden) state, then finalizes it. */
export async function confirmRound(roundId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const round = await prisma.conductorRound.findUnique({ where: { id: roundId }, include: { selections: true } });
  if (!round) return { ok: false, error: "Round not found." };
  if (round.status !== "draft") return { ok: false, error: "Round is not a draft." };

  const settings: ConductorSettings = await getConductorSettings();

  for (const s of round.selections) {
    if (s.memberId === null) return { ok: false, error: `Day ${s.slotIndex + 1} (${s.role}) has no member assigned.` };
  }

  const conductorIds = round.selections.filter((s) => s.role === "conductor").map((s) => s.memberId);
  if (new Set(conductorIds).size !== conductorIds.length) {
    return { ok: false, error: "The same member is Conductor more than once in this round." };
  }

  if (!settings.allowDuplicatePassengers) {
    const passengerIds = round.selections.filter((s) => s.role === "passenger").map((s) => s.memberId);
    if (new Set(passengerIds).size !== passengerIds.length) {
      return { ok: false, error: "The same member is Passenger more than once in this round." };
    }
  }

  const bySlot = new Map<number, { conductor?: number | null; passenger?: number | null }>();
  for (const s of round.selections) {
    const entry = bySlot.get(s.slotIndex) ?? {};
    entry[s.role as "conductor" | "passenger"] = s.memberId;
    bySlot.set(s.slotIndex, entry);
  }
  for (const [slotIndex, entry] of bySlot) {
    if (entry.conductor !== undefined && entry.conductor === entry.passenger) {
      return { ok: false, error: `Day ${slotIndex + 1}: the same member is both Conductor and Passenger.` };
    }
  }

  await prisma.conductorRound.update({ where: { id: roundId }, data: { status: "confirmed", confirmedAt: new Date() } });
  return { ok: true };
}

/**
 * Reverts a confirmed round back to draft. computeStandings() only counts a round's frozen
 * pointsAtSelection toward lessSelected while it's confirmed, so this alone restores every
 * affected member's balance to what it was before - no separate point mutation needed. The
 * round and its picks are left in place (not deleted) so they can still be reviewed, edited,
 * or re-confirmed rather than lost outright.
 */
export async function unconfirmRound(roundId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const round = await prisma.conductorRound.findUnique({ where: { id: roundId } });
  if (!round) return { ok: false, error: "Round not found." };
  if (round.status !== "confirmed") return { ok: false, error: "Round is not confirmed." };

  await prisma.conductorRound.update({ where: { id: roundId }, data: { status: "draft", confirmedAt: null } });
  return { ok: true };
}
