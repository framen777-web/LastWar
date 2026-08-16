import { prisma } from "@/lib/db";
import { computeStandings } from "./points";
import { getConductorCategoryWeekValues, type CategoryWeekValue } from "./stats";
import { getConductorSettings, isRandomRule, WEEKDAYS, type ConductorSettings, type Weekday } from "./settings";

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

/** Resolves one passenger slot's field+rank rule against that week's leaderboard, honoring availability and auto-resolve. */
function resolvePassenger(
  leaderboard: LeaderboardEntry[],
  requestedRank: number,
  isAvailable: (memberId: number) => boolean,
  autoResolve: boolean
): { memberId: number | null; sourceRank: number | null; collision: boolean; collisionReason: string | null } {
  const requested = leaderboard[requestedRank - 1];
  if (!requested) {
    return { memberId: null, sourceRank: null, collision: true, collisionReason: `No member at rank ${requestedRank}.` };
  }
  if (isAvailable(requested.memberId)) {
    return { memberId: requested.memberId, sourceRank: requestedRank, collision: false, collisionReason: null };
  }
  if (autoResolve) {
    let idx = requestedRank; // requestedRank-1 is the 0-based index of the requested pick, so this is the next one down
    while (idx < leaderboard.length && !isAvailable(leaderboard[idx].memberId)) idx++;
    if (idx < leaderboard.length) {
      return { memberId: leaderboard[idx].memberId, sourceRank: idx + 1, collision: false, collisionReason: null };
    }
    return { memberId: null, sourceRank: null, collision: true, collisionReason: "No available member found at or below the requested rank." };
  }
  return {
    memberId: requested.memberId,
    sourceRank: requestedRank,
    collision: true,
    collisionReason: "Collides with this day's Conductor or an existing Passenger pick - change the member or rank.",
  };
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
  return { settings, standings, categoryValues, members, memberNameById, weeksNeeded };
}

/** Generates and persists a new draft round: top-N conductors by balance, one passenger per day per the weekday rules. */
export async function generateDraft(weeksInCycle: number, startWeek: number): Promise<{ roundId: number; slots: DraftSlot[] }> {
  const slotCount = weeksInCycle * 7;
  const { settings, standings, categoryValues, members, memberNameById } = await loadContext(startWeek, slotCount);

  const slots: DraftSlot[] = [];
  const conductorByIndex = new Map<number, number>();

  for (let i = 0; i < slotCount; i++) {
    const pick = standings[i];
    slots.push({
      slotIndex: i,
      weekday: weekdayForSlot(i),
      weekNumber: weekForSlot(i, startWeek),
      role: "conductor",
      memberId: pick?.memberId ?? null,
      memberName: pick ? (memberNameById.get(pick.memberId) ?? pick.memberName) : null,
      pointsAtSelection: pick?.total ?? null,
      sourceCategoryKey: null,
      sourceRank: null,
      manualOverride: false,
      collision: !pick,
      collisionReason: pick ? null : "Not enough eligible members for this slot.",
    });
    if (pick) conductorByIndex.set(i, pick.memberId);
  }

  const usedPassengerMemberIds = new Set<number>();
  const activeMemberIds = members.map((m) => m.id);
  // Each weekday's rule always points at the same category ("Monday is always vs"), but the
  // rank used for it climbs by 1 every time that category comes up again - same week or a
  // later one in this cycle - instead of resetting back to the rule's configured rank each
  // time. Mirrors the math overrideSlotRankCascade uses for a manual rank edit.
  const categoryLastRank = new Map<string, number>();

  for (let i = 0; i < slotCount; i++) {
    const weekday = weekdayForSlot(i);
    const weekNumber = weekForSlot(i, startWeek);
    const rule = settings.weekdayRules[weekday];
    const conductorMemberId = conductorByIndex.get(i) ?? null;
    const isAvailable = (candidateId: number) =>
      candidateId !== conductorMemberId && (settings.allowDuplicatePassengers || !usedPassengerMemberIds.has(candidateId));

    let result: { memberId: number | null; sourceRank: number | null; collision: boolean; collisionReason: string | null };
    let sourceCategoryKey: string | null = null;
    let requestedRank: number | null = null;

    if (isRandomRule(rule)) {
      const pool = activeMemberIds.filter(isAvailable);
      result =
        pool.length > 0
          ? { memberId: pool[Math.floor(Math.random() * pool.length)], sourceRank: null, collision: false, collisionReason: null }
          : { memberId: null, sourceRank: null, collision: true, collisionReason: "No eligible member available for Random." };
    } else {
      sourceCategoryKey = rule.categoryKey;
      requestedRank = categoryLastRank.has(rule.categoryKey) ? categoryLastRank.get(rule.categoryKey)! + 1 : rule.rank;
      categoryLastRank.set(rule.categoryKey, requestedRank);
      const leaderboard = buildLeaderboard(members, categoryValues, rule.categoryKey, weekNumber);
      result = resolvePassenger(leaderboard, requestedRank, isAvailable, settings.autoResolveCollisions);
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
      // that week, or every candidate already used) - a collision should read "VS, no
      // member found", not silently mislabel the slot as Random.
      sourceCategoryKey,
      sourceRank: result.sourceRank ?? requestedRank,
      manualOverride: false,
      collision: result.collision,
      collisionReason: result.collisionReason,
    });
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
 * Any Passenger slot still unresolved (no member found the last time it was resolved) gets
 * one more attempt every time the round is loaded - not just at generation time - since the
 * conditions that blocked it (a week's data not being in yet, another slot using up the only
 * available candidate) can change afterward. A slot the admin has manually touched is never
 * re-picked out from under them; it stays exactly as they left it.
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
    const isAvailable = (candidateId: number) =>
      candidateId !== conductorMemberBySlot.get(s.slotIndex) &&
      (settings.allowDuplicatePassengers || !usedPassengerMemberIds.has(candidateId));

    let result: { memberId: number | null; sourceRank: number | null };
    if (s.sourceCategoryKey) {
      const leaderboard = buildLeaderboard(activeMembers, categoryValues, s.sourceCategoryKey, s.weekNumber);
      const requestedRank = s.sourceRank ?? 1;
      result = resolvePassenger(leaderboard, requestedRank, isAvailable, settings.autoResolveCollisions);
    } else {
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

  const members = await prisma.member.findMany();
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  const slots: DraftSlot[] = round.selections
    .map((s) => ({
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
      collision: s.memberId === null,
      collisionReason: s.memberId === null ? "No member assigned." : null,
    }))
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

  const members = await prisma.member.findMany({ where: { isActive: true } });
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
    const settings = await getConductorSettings();
    const conductorSlot = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "conductor");
    const usedElsewhere = new Set(
      round.selections
        .filter((s) => s.role === "passenger" && s.slotIndex !== slotIndex && s.memberId !== null)
        .map((s) => s.memberId as number)
    );
    const isAvailable = (candidateId: number) =>
      candidateId !== conductorSlot?.memberId && (settings.allowDuplicatePassengers || !usedElsewhere.has(candidateId));

    if (input.sourceCategoryKey === null) {
      const pool = members.map((m) => m.id).filter(isAvailable);
      memberId = pool.length > 0 ? pool[Math.floor(Math.random() * pool.length)] : null;
      sourceCategoryKey = null;
      sourceRank = null;
    } else {
      const categoryValues = await getConductorCategoryWeekValues();
      const leaderboard = buildLeaderboard(members, categoryValues, input.sourceCategoryKey, existing.weekNumber);
      const requestedRank = existing.sourceRank ?? 1;
      const result = resolvePassenger(leaderboard, requestedRank, isAvailable, settings.autoResolveCollisions);
      sourceCategoryKey = input.sourceCategoryKey;
      memberId = result.memberId;
      sourceRank = result.sourceRank ?? requestedRank;
    }
  } else if (input.sourceRank !== undefined && role === "passenger" && existing.sourceCategoryKey) {
    const settings = await getConductorSettings();
    const categoryValues = await getConductorCategoryWeekValues();
    const leaderboard = buildLeaderboard(members, categoryValues, existing.sourceCategoryKey, existing.weekNumber);
    const conductorSlot = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "conductor");
    const usedElsewhere = new Set(
      round.selections
        .filter((s) => s.role === "passenger" && s.slotIndex !== slotIndex && s.memberId !== null)
        .map((s) => s.memberId as number)
    );
    const isAvailable = (candidateId: number) =>
      candidateId !== conductorSlot?.memberId && (settings.allowDuplicatePassengers || !usedElsewhere.has(candidateId));
    const result = resolvePassenger(leaderboard, input.sourceRank, isAvailable, false);
    memberId = result.memberId;
    sourceRank = result.sourceRank ?? input.sourceRank;
  }

  const updated = await prisma.conductorSelection.update({
    where: { id: existing.id },
    data: { memberId, pointsAtSelection, sourceCategoryKey, sourceRank, manualOverride: true },
  });

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
      collision: updated.memberId === null,
      collisionReason: updated.memberId === null ? "No member assigned." : null,
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

  const [settings, members] = await Promise.all([getConductorSettings(), prisma.member.findMany({ where: { isActive: true } })]);
  const memberNameById = new Map(members.map((m) => [m.id, m.name]));

  const conductorSlot = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "conductor");
  const usedElsewhere = new Set(
    round.selections
      .filter((s) => s.role === "passenger" && s.slotIndex !== slotIndex && s.memberId !== null)
      .map((s) => s.memberId as number)
  );
  const isAvailable = (candidateId: number) =>
    candidateId !== conductorSlot?.memberId && (settings.allowDuplicatePassengers || !usedElsewhere.has(candidateId));

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

/**
 * Overriding a category-based Passenger's rank cascades: every other Passenger slot in
 * this round sharing the same category gets re-ranked in chronological order relative to
 * the changed slot, so a fixed top-ranked member isn't picked again for every later
 * occurrence of that category. E.g. setting the first "vs" Passenger to rank 1 pushes the
 * next "vs" Passenger to rank 2, the one after to rank 3, and so on - each occurrence still
 * resolved against *its own* week's leaderboard (a category can repeat across weeks in a
 * multi-week cycle), just walking one rank deeper each time.
 */
export async function overrideSlotRankCascade(
  roundId: number,
  slotIndex: number,
  sourceRank: number
): Promise<{ ok: true; slots: DraftSlot[] } | { ok: false; error: string }> {
  const round = await prisma.conductorRound.findUnique({ where: { id: roundId }, include: { selections: true } });
  if (!round) return { ok: false, error: "Round not found." };
  if (round.status !== "draft") return { ok: false, error: "Only draft rounds can be edited." };

  const changed = round.selections.find((s) => s.slotIndex === slotIndex && s.role === "passenger");
  if (!changed) return { ok: false, error: "Slot not found." };
  if (!changed.sourceCategoryKey) return { ok: false, error: "This slot is Random, not category-based - there's no rank to cascade." };

  const sameCategory = round.selections
    .filter((s) => s.role === "passenger" && s.sourceCategoryKey === changed.sourceCategoryKey)
    .sort((a, b) => a.slotIndex - b.slotIndex);
  const changedPos = sameCategory.findIndex((s) => s.slotIndex === slotIndex);

  const [settings, categoryValues, members] = await Promise.all([
    getConductorSettings(),
    getConductorCategoryWeekValues(),
    prisma.member.findMany({ where: { isActive: true } }),
  ]);

  const conductorMemberBySlot = new Map(round.selections.filter((s) => s.role === "conductor").map((s) => [s.slotIndex, s.memberId]));
  // Passengers picked for a *different* category stay fixed - only this category's own
  // occurrences get walked and re-resolved.
  const usedElsewhere = new Set(
    round.selections
      .filter((s) => s.role === "passenger" && s.sourceCategoryKey !== changed.sourceCategoryKey && s.memberId !== null)
      .map((s) => s.memberId as number)
  );
  const usedInGroup = new Set<number>();

  const updates: { id: number; memberId: number | null; sourceRank: number | null }[] = [];
  for (let p = 0; p < sameCategory.length; p++) {
    const slot = sameCategory[p];
    const requestedRank = Math.max(1, sourceRank + (p - changedPos));
    const leaderboard = buildLeaderboard(members, categoryValues, changed.sourceCategoryKey, slot.weekNumber);
    const isAvailable = (candidateId: number) =>
      candidateId !== conductorMemberBySlot.get(slot.slotIndex) &&
      !usedElsewhere.has(candidateId) &&
      (settings.allowDuplicatePassengers || !usedInGroup.has(candidateId));
    const result = resolvePassenger(leaderboard, requestedRank, isAvailable, settings.autoResolveCollisions);
    if (result.memberId !== null) usedInGroup.add(result.memberId);
    updates.push({ id: slot.id, memberId: result.memberId, sourceRank: result.sourceRank ?? requestedRank });
  }

  await prisma.$transaction(
    updates.map((u) =>
      prisma.conductorSelection.update({
        where: { id: u.id },
        data: { memberId: u.memberId, sourceRank: u.sourceRank, manualOverride: true },
      })
    )
  );

  const reloaded = await getRoundSlots(roundId);
  return reloaded ? { ok: true, slots: reloaded.slots } : { ok: false, error: "Failed to reload round after cascading." };
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
