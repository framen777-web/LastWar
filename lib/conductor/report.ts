import type { DraftSlot } from "./selection";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

/** Conductor + Passenger per day for a round, formatted for pasting into an announcement (e.g. email). */
export function formatAnnouncementText(round: { weeksInCycle: number; startWeek: number }, slots: DraftSlot[]): string {
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
