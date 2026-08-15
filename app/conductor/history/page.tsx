import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireMenuAccess } from "@/lib/menuAccess";

export default async function ConductorHistoryPage() {
  await requireMenuAccess("conductor-history");

  const rounds = await prisma.conductorRound.findMany({
    where: { status: "confirmed" },
    orderBy: { confirmedAt: "desc" },
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Conductor History</h1>

      {rounds.length === 0 ? (
        <p className="text-neutral-500 text-sm">No confirmed rotations yet.</p>
      ) : (
        <div className="flex flex-col gap-2 max-w-md">
          {rounds.map((r) => {
            const label = r.weeksInCycle > 1 ? `Weeks ${r.startWeek}-${r.startWeek + r.weeksInCycle - 1}` : `Week ${r.startWeek}`;
            return (
              <Link
                key={r.id}
                href={`/conductor/history/${r.id}`}
                className="border border-neutral-200 rounded px-3 py-2 hover:bg-neutral-50 flex items-center justify-between"
              >
                <span className="font-medium">{label}</span>
                <span className="text-neutral-500 text-xs">
                  Confirmed {r.confirmedAt ? new Date(r.confirmedAt).toLocaleDateString() : ""}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
