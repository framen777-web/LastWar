"use client";

import { useState } from "react";
import { CopyTextButton } from "@/components/CopyTextButton";

// Mirrors lib/conductor/selection.ts's DraftSlot shape locally - that module touches
// @/lib/db (a server-only Prisma client holding real database credentials) and can't be
// imported into a client component, same reasoning as ConductorSettingsClient.tsx.
type DraftSlot = {
  slotIndex: number;
  weekday: string;
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

type Round = { id: number; weeksInCycle: number; startWeek: number; status: string };
type Category = { key: string; name: string };

const RANDOM_VALUE = "__random__";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

function buildAnnouncementText(round: Round, slots: DraftSlot[]): string {
  const slotCount = round.weeksInCycle * 7;
  const endWeek = round.startWeek + round.weeksInCycle - 1;
  const weekLabel = round.weeksInCycle > 1 ? `Weeks ${round.startWeek}-${endWeek}` : `Week ${round.startWeek}`;
  const lines = [`Conductor Rotation - ${weekLabel}`, ""];
  for (let i = 0; i < slotCount; i++) {
    const conductor = slots.find((s) => s.slotIndex === i && s.role === "conductor");
    const passenger = slots.find((s) => s.slotIndex === i && s.role === "passenger");
    const dayLabel = WEEKDAY_LABELS[conductor?.weekday ?? passenger?.weekday ?? ""] ?? `Day ${i + 1}`;
    const weekSuffix = round.weeksInCycle > 1 ? ` (Week ${conductor?.weekNumber ?? passenger?.weekNumber})` : "";
    lines.push(`${dayLabel}${weekSuffix}`);
    lines.push(`  Conductor: ${conductor?.memberName ?? "—"}`);
    lines.push(`  Passenger: ${passenger?.memberName ?? "—"}`);
  }
  return lines.join("\n").trim();
}

export function SelectClient({
  isAdmin,
  defaultWeeksInCycle,
  defaultStartWeek,
  members,
  categories,
}: {
  isAdmin: boolean;
  defaultWeeksInCycle: number;
  defaultStartWeek: number;
  members: { id: number; name: string }[];
  categories: Category[];
}) {
  const [weeksInCycle, setWeeksInCycle] = useState(defaultWeeksInCycle);
  const [startWeek, setStartWeek] = useState(defaultStartWeek);
  const [round, setRound] = useState<Round | null>(null);
  const [slots, setSlots] = useState<DraftSlot[]>([]);
  const [generating, setGenerating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<string | null>(null);

  async function refetchRound(id: number) {
    const res = await fetch(`/api/conductor/rounds/${id}`);
    const data = await res.json();
    if (res.ok) {
      setRound(data.round);
      setSlots(data.slots);
    }
  }

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const res = await fetch("/api/conductor/rounds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weeksInCycle, startWeek }),
    });
    const data = await res.json();
    setGenerating(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to generate draft.");
      return;
    }
    await refetchRound(data.roundId);
  }

  async function handleOverrideMember(slot: DraftSlot, memberId: number) {
    if (!round) return;
    const key = `${slot.slotIndex}:${slot.role}`;
    setPendingSlot(key);
    await fetch(`/api/conductor/rounds/${round.id}/slots`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotIndex: slot.slotIndex, role: slot.role, memberId }),
    });
    await refetchRound(round.id);
    setPendingSlot(null);
  }

  async function handleOverrideRank(slot: DraftSlot, sourceRank: number) {
    if (!round) return;
    const key = `${slot.slotIndex}:${slot.role}`;
    setPendingSlot(key);
    await fetch(`/api/conductor/rounds/${round.id}/slots`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotIndex: slot.slotIndex, role: slot.role, sourceRank }),
    });
    await refetchRound(round.id);
    setPendingSlot(null);
  }

  async function handleOverrideCategory(slot: DraftSlot, categoryKey: string | null) {
    if (!round) return;
    const key = `${slot.slotIndex}:${slot.role}`;
    setPendingSlot(key);
    await fetch(`/api/conductor/rounds/${round.id}/slots`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotIndex: slot.slotIndex, role: slot.role, sourceCategoryKey: categoryKey }),
    });
    await refetchRound(round.id);
    setPendingSlot(null);
  }

  async function handleReroll(slot: DraftSlot) {
    if (!round) return;
    const key = `${slot.slotIndex}:${slot.role}`;
    setPendingSlot(key);
    await fetch(`/api/conductor/rounds/${round.id}/slots`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slotIndex: slot.slotIndex, role: slot.role, reroll: true }),
    });
    await refetchRound(round.id);
    setPendingSlot(null);
  }

  async function handleConfirm() {
    if (!round) return;
    setConfirming(true);
    setError(null);
    const res = await fetch(`/api/conductor/rounds/${round.id}/confirm`, { method: "POST" });
    const data = await res.json();
    setConfirming(false);
    if (!res.ok) {
      setError(data.error ?? "Failed to confirm.");
      return;
    }
    await refetchRound(round.id);
  }

  const isDraft = round?.status === "draft";
  const hasCollisions = slots.some((s) => s.collision);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Select Conductors &amp; Passengers</h1>

      {!round && (
        <div className="flex items-center gap-2 text-sm flex-wrap">
          <label htmlFor="weeksInCycle" className="font-medium">
            Weeks per cycle
          </label>
          <input
            id="weeksInCycle"
            type="number"
            min={1}
            value={weeksInCycle}
            onChange={(e) => setWeeksInCycle(Number(e.target.value) || 1)}
            className="border border-neutral-300 rounded px-2 py-1 w-20"
          />
          <label htmlFor="startWeek" className="font-medium">
            Start week
          </label>
          <input
            id="startWeek"
            type="number"
            min={1}
            value={startWeek}
            onChange={(e) => setStartWeek(Number(e.target.value) || 1)}
            className="border border-neutral-300 rounded px-2 py-1 w-24"
          />
          <button
            onClick={handleGenerate}
            disabled={generating || !isAdmin}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {generating ? "Generating…" : "Generate draft"}
          </button>
          {!isAdmin && <span className="text-neutral-500 text-xs">Only admins can generate a selection.</span>}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {round && (
        <>
          <p className="text-neutral-500 text-sm">
            {round.weeksInCycle > 1 ? `Weeks ${round.startWeek}-${round.startWeek + round.weeksInCycle - 1}` : `Week ${round.startWeek}`}{" "}
            - <span className={round.status === "confirmed" ? "text-green-700 font-medium" : "font-medium"}>{round.status}</span>
            {hasCollisions && isDraft && <span className="text-amber-600 ml-2">Some slots need attention before confirming.</span>}
          </p>

          <CombinedSlotTable
            slots={slots}
            members={members}
            categories={categories}
            editable={isAdmin && isDraft}
            pendingSlot={pendingSlot}
            onOverrideMember={handleOverrideMember}
            onOverrideRank={handleOverrideRank}
            onOverrideCategory={handleOverrideCategory}
            onReroll={handleReroll}
          />

          {isDraft && isAdmin && (
            <button
              onClick={handleConfirm}
              disabled={confirming}
              className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
            >
              {confirming ? "Confirming…" : "Confirm selection"}
            </button>
          )}

          {round.status === "confirmed" && (
            <div className="flex flex-col gap-2">
              <h2 className="text-lg font-semibold">Announcement</h2>
              <textarea
                readOnly
                value={buildAnnouncementText(round, slots)}
                rows={round.weeksInCycle * 7 * 3 + 2}
                className="border border-neutral-300 rounded px-3 py-2 text-sm font-mono w-full max-w-lg"
              />
              <CopyTextButton text={buildAnnouncementText(round, slots)} label="Copy announcement" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CombinedSlotTable({
  slots,
  members,
  categories,
  editable,
  pendingSlot,
  onOverrideMember,
  onOverrideRank,
  onOverrideCategory,
  onReroll,
}: {
  slots: DraftSlot[];
  members: { id: number; name: string }[];
  categories: Category[];
  editable: boolean;
  pendingSlot: string | null;
  onOverrideMember: (slot: DraftSlot, memberId: number) => void;
  onOverrideRank: (slot: DraftSlot, rank: number) => void;
  onOverrideCategory: (slot: DraftSlot, categoryKey: string | null) => void;
  onReroll: (slot: DraftSlot) => void;
}) {
  const slotIndexes = Array.from(new Set(slots.map((s) => s.slotIndex))).sort((a, b) => a - b);

  // Flags any member picked in more than one slot across the whole round (either role) so
  // it's easy to spot at a glance, whether that's intentional or a mistake.
  const memberCounts = new Map<number, number>();
  for (const s of slots) {
    if (s.memberId === null) continue;
    memberCounts.set(s.memberId, (memberCounts.get(s.memberId) ?? 0) + 1);
  }
  const duplicateMemberIds = new Set([...memberCounts.entries()].filter(([, count]) => count > 1).map(([id]) => id));

  return (
    <div className="border border-neutral-200 rounded overflow-hidden overflow-x-auto max-w-4xl">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 text-left bg-neutral-50">
            <th className="py-1.5 px-3">Day</th>
            <th className="py-1.5 px-3">Week</th>
            <th className="py-1.5 px-3">Conductor</th>
            <th className="py-1.5 px-3">Points</th>
            <th className="py-1.5 px-3">Passenger</th>
            <th className="py-1.5 px-3">Field / Rank</th>
          </tr>
        </thead>
        <tbody>
          {slotIndexes.map((slotIndex) => {
            const conductor = slots.find((s) => s.slotIndex === slotIndex && s.role === "conductor");
            const passenger = slots.find((s) => s.slotIndex === slotIndex && s.role === "passenger");
            const weekday = conductor?.weekday ?? passenger?.weekday ?? "";
            const weekNumber = conductor?.weekNumber ?? passenger?.weekNumber ?? "";
            const rowHasCollision = conductor?.collision || passenger?.collision;
            const pendingPassenger = pendingSlot === `${slotIndex}:passenger`;

            return (
              <tr key={slotIndex} className={`border-b border-neutral-100 ${rowHasCollision ? "bg-amber-50" : ""}`}>
                <td className="py-1.5 px-3 capitalize whitespace-nowrap">{WEEKDAY_LABELS[weekday] ?? weekday}</td>
                <td className="py-1.5 px-3 text-neutral-500">{weekNumber}</td>
                <td className="py-1.5 px-3">
                  {conductor && (
                    <MemberCell
                      slot={conductor}
                      members={members}
                      editable={editable}
                      pendingSlot={pendingSlot}
                      onOverrideMember={onOverrideMember}
                      isDuplicate={conductor.memberId !== null && duplicateMemberIds.has(conductor.memberId)}
                    />
                  )}
                </td>
                <td className="py-1.5 px-3 text-neutral-600 whitespace-nowrap">{conductor?.pointsAtSelection?.toFixed(2) ?? "—"}</td>
                <td className="py-1.5 px-3">
                  {passenger && (
                    <MemberCell
                      slot={passenger}
                      members={members}
                      editable={editable}
                      pendingSlot={pendingSlot}
                      onOverrideMember={onOverrideMember}
                      isDuplicate={passenger.memberId !== null && duplicateMemberIds.has(passenger.memberId)}
                    />
                  )}
                </td>
                <td className="py-1.5 px-3 text-neutral-600 whitespace-nowrap">
                  {passenger && (
                    <span className="inline-flex items-center gap-1">
                      {editable ? (
                        <select
                          value={passenger.sourceCategoryKey ?? RANDOM_VALUE}
                          disabled={pendingPassenger}
                          onChange={(e) =>
                            onOverrideCategory(passenger, e.target.value === RANDOM_VALUE ? null : e.target.value)
                          }
                          title="Which day gets which field is set in Conductor Settings - this overrides just this one slot"
                          className="border border-neutral-300 rounded px-1 py-0.5 text-xs"
                        >
                          <option value={RANDOM_VALUE}>Random</option>
                          {categories.map((c) => (
                            <option key={c.key} value={c.key}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        (categories.find((c) => c.key === passenger.sourceCategoryKey)?.name ?? passenger.sourceCategoryKey ?? "Random")
                      )}

                      {passenger.sourceCategoryKey ? (
                        editable ? (
                          <input
                            type="number"
                            min={1}
                            disabled={pendingPassenger}
                            defaultValue={passenger.sourceRank ?? 1}
                            onBlur={(e) => onOverrideRank(passenger, Number(e.target.value) || 1)}
                            title="Changing this cascades to every other Passenger slot with the same field"
                            className="border border-neutral-300 rounded px-1 py-0.5 text-xs w-14"
                          />
                        ) : (
                          `#${passenger.sourceRank}`
                        )
                      ) : (
                        editable && (
                          <button
                            type="button"
                            onClick={() => onReroll(passenger)}
                            disabled={pendingPassenger}
                            title="Pick a new random member for just this slot"
                            className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs disabled:opacity-50"
                          >
                            🎲 Reroll
                          </button>
                        )
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MemberCell({
  slot,
  members,
  editable,
  pendingSlot,
  onOverrideMember,
  isDuplicate,
}: {
  slot: DraftSlot;
  members: { id: number; name: string }[];
  editable: boolean;
  pendingSlot: string | null;
  onOverrideMember: (slot: DraftSlot, memberId: number) => void;
  isDuplicate: boolean;
}) {
  const key = `${slot.slotIndex}:${slot.role}`;
  const pending = pendingSlot === key;

  const duplicateClass = isDuplicate ? "bg-red-50 ring-1 ring-red-300 rounded px-1" : "";

  return (
    <>
      {editable ? (
        <select
          value={slot.memberId ?? ""}
          disabled={pending}
          onChange={(e) => onOverrideMember(slot, Number(e.target.value))}
          title={isDuplicate ? "This member is selected in more than one slot this round" : undefined}
          className={`border border-neutral-300 rounded px-1.5 py-0.5 text-xs ${isDuplicate ? "ring-1 ring-red-400 bg-red-50" : ""}`}
        >
          <option value="" disabled>
            Select…
          </option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      ) : (
        <span
          title={isDuplicate ? "This member is selected in more than one slot this round" : undefined}
          className={duplicateClass}
        >
          {slot.memberName ?? "—"}
        </span>
      )}
      {slot.collision && <div className="text-amber-700 text-xs mt-0.5">{slot.collisionReason}</div>}
    </>
  );
}
