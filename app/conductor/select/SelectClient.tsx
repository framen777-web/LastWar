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
}: {
  isAdmin: boolean;
  defaultWeeksInCycle: number;
  defaultStartWeek: number;
  members: { id: number; name: string }[];
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

  const conductorSlots = slots.filter((s) => s.role === "conductor").sort((a, b) => a.slotIndex - b.slotIndex);
  const passengerSlots = slots.filter((s) => s.role === "passenger").sort((a, b) => a.slotIndex - b.slotIndex);
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

          <SlotTable
            title="Conductors"
            slots={conductorSlots}
            members={members}
            editable={isAdmin && isDraft}
            pendingSlot={pendingSlot}
            onOverrideMember={handleOverrideMember}
            valueColumn="points"
          />

          <SlotTable
            title="Passengers"
            slots={passengerSlots}
            members={members}
            editable={isAdmin && isDraft}
            pendingSlot={pendingSlot}
            onOverrideMember={handleOverrideMember}
            onOverrideRank={handleOverrideRank}
            valueColumn="source"
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

function SlotTable({
  title,
  slots,
  members,
  editable,
  pendingSlot,
  onOverrideMember,
  onOverrideRank,
  valueColumn,
}: {
  title: string;
  slots: DraftSlot[];
  members: { id: number; name: string }[];
  editable: boolean;
  pendingSlot: string | null;
  onOverrideMember: (slot: DraftSlot, memberId: number) => void;
  onOverrideRank?: (slot: DraftSlot, rank: number) => void;
  valueColumn: "points" | "source";
}) {
  return (
    <div className="border border-neutral-200 rounded overflow-hidden max-w-2xl">
      <div className="bg-neutral-100 px-3 py-1 font-semibold">{title}</div>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-neutral-200 text-left">
            <th className="py-1.5 px-3">Day</th>
            <th className="py-1.5 px-3">Week</th>
            <th className="py-1.5 px-3">Member</th>
            <th className="py-1.5 px-3">{valueColumn === "points" ? "Points" : "Field / Rank"}</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((slot) => {
            const key = `${slot.slotIndex}:${slot.role}`;
            const pending = pendingSlot === key;
            return (
              <tr key={key} className={`border-b border-neutral-100 ${slot.collision ? "bg-amber-50" : ""}`}>
                <td className="py-1.5 px-3 capitalize">{WEEKDAY_LABELS[slot.weekday] ?? slot.weekday}</td>
                <td className="py-1.5 px-3 text-neutral-500">{slot.weekNumber}</td>
                <td className="py-1.5 px-3">
                  {editable ? (
                    <select
                      value={slot.memberId ?? ""}
                      disabled={pending}
                      onChange={(e) => onOverrideMember(slot, Number(e.target.value))}
                      className="border border-neutral-300 rounded px-1.5 py-0.5 text-xs"
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
                    (slot.memberName ?? "—")
                  )}
                  {slot.collision && <div className="text-amber-700 text-xs mt-0.5">{slot.collisionReason}</div>}
                </td>
                <td className="py-1.5 px-3 text-neutral-600">
                  {valueColumn === "points"
                    ? (slot.pointsAtSelection?.toFixed(2) ?? "—")
                    : slot.sourceCategoryKey
                      ? (
                        <span className="inline-flex items-center gap-1">
                          {slot.sourceCategoryKey}
                          {editable && onOverrideRank ? (
                            <input
                              type="number"
                              min={1}
                              disabled={pending}
                              defaultValue={slot.sourceRank ?? 1}
                              onBlur={(e) => onOverrideRank(slot, Number(e.target.value) || 1)}
                              className="border border-neutral-300 rounded px-1 py-0.5 text-xs w-14"
                            />
                          ) : (
                            `#${slot.sourceRank}`
                          )}
                        </span>
                      )
                      : "Random"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
