import { notFound } from "next/navigation";
import { getRoundSlots } from "@/lib/conductor/selection";
import { formatAnnouncementText } from "@/lib/conductor/report";
import { CopyTextButton } from "@/components/CopyTextButton";
import { requireMenuAccess } from "@/lib/menuAccess";
import { UnconfirmButton } from "./UnconfirmButton";

const WEEKDAY_LABELS: Record<string, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export default async function ConductorHistoryDetailPage({ params }: PageProps<"/conductor/history/[id]">) {
  const user = await requireMenuAccess("conductor-history");
  const { id } = await params;

  const result = await getRoundSlots(Number(id));
  if (!result) notFound();
  const { round, slots } = result;

  const label = round.weeksInCycle > 1 ? `Weeks ${round.startWeek}-${round.startWeek + round.weeksInCycle - 1}` : `Week ${round.startWeek}`;
  const slotCount = round.weeksInCycle * 7;
  const announcement = formatAnnouncementText(round, slots);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Conductor Rotation - {label}</h1>

      <div className="border border-neutral-200 rounded overflow-hidden max-w-xl">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-neutral-200 text-left">
              <th className="py-1.5 px-3">Day</th>
              <th className="py-1.5 px-3">Week</th>
              <th className="py-1.5 px-3">Conductor</th>
              <th className="py-1.5 px-3">Passenger</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: slotCount }, (_, i) => i).map((i) => {
              const conductor = slots.find((s) => s.slotIndex === i && s.role === "conductor");
              const passenger = slots.find((s) => s.slotIndex === i && s.role === "passenger");
              return (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-1.5 px-3">{WEEKDAY_LABELS[conductor?.weekday ?? passenger?.weekday ?? ""] ?? `Day ${i + 1}`}</td>
                  <td className="py-1.5 px-3 text-neutral-500">{conductor?.weekNumber ?? passenger?.weekNumber}</td>
                  <td className="py-1.5 px-3">{conductor?.memberName ?? "—"}</td>
                  <td className="py-1.5 px-3">{passenger?.memberName ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Announcement</h2>
        <textarea readOnly value={announcement} rows={slotCount * 3 + 2} className="border border-neutral-300 rounded px-3 py-2 text-sm font-mono w-full max-w-lg" />
        <CopyTextButton text={announcement} label="Copy announcement" />
      </div>

      {user.role === "ADMIN" && round.status === "confirmed" && (
        <div className="border border-neutral-200 rounded p-4 flex flex-col gap-2 max-w-xl">
          <h2 className="font-semibold text-sm">Undo this confirmation</h2>
          <p className="text-neutral-500 text-xs">
            Sends this round back to draft and restores every listed Conductor&apos;s points balance to what it was
            before this round was confirmed. Use this if this round was confirmed by mistake or needs to be redone.
          </p>
          <UnconfirmButton roundId={round.id} />
        </div>
      )}
    </div>
  );
}
