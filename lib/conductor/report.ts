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

  // Cycle-relative week numbers (Week 1, Week 2...) rather than the real calendar week
  // (65, 66...) - a "Week 2" section heading before its 7 days, even for a single-cycle
  // round where that's just "Week 1".
  for (let i = 0; i < slotCount; i++) {
    const cycleWeek = Math.floor(i / 7) + 1;
    if (i % 7 === 0) {
      if (i > 0) lines.push("");
      lines.push(`Week ${cycleWeek}`);
    }
    const conductor = slots.find((s) => s.slotIndex === i && s.role === "conductor");
    const passenger = slots.find((s) => s.slotIndex === i && s.role === "passenger");
    const dayLabel = WEEKDAY_LABELS[conductor?.weekday ?? passenger?.weekday ?? ""] ?? `Day ${i + 1}`;
    lines.push(dayLabel);
    lines.push(`  Conductor: ${conductor?.memberName ?? "—"}`);
    lines.push(`  Passenger: ${passenger?.memberName ?? "—"}`);
  }

  return lines.join("\n").trim();
}
