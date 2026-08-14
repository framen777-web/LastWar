import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/dal";

const STATUS_STYLES: Record<string, string> = {
  committed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  pending: "bg-neutral-100 text-neutral-800",
};

export default async function RawDataPage() {
  await requireAdmin();
  const extractions = await prisma.rawExtraction.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Raw extractions</h1>
      <p className="text-xs text-amber-600">
        Not linked from any menu right now — reachable only via this direct URL.
      </p>
      <p className="text-sm text-neutral-500">
        Every classify/extract result, most recent first — the audit trail behind the dashboard numbers.
      </p>

      <ul className="flex flex-col gap-3">
        {extractions.map((ex) => (
          <li key={ex.id} className="border border-neutral-200 rounded p-3 flex gap-3">
            {ex.imageFilename.startsWith("/uploads/") && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ex.imageFilename} alt={ex.categoryKey} className="w-20 h-20 object-cover rounded border border-neutral-200" />
            )}
            <div className="flex-1 flex flex-col gap-1 text-sm min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{ex.categoryKey}</span>
                <span className="text-neutral-500">week {ex.weekNumber}</span>
                <span className="text-neutral-500">{Math.round(ex.confidence * 100)}% confidence</span>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[ex.status] ?? ""}`}>
                  {ex.status}
                </span>
              </div>
              <p className="text-neutral-400 text-xs">{ex.createdAt.toLocaleString()}</p>
              <pre className="text-xs bg-neutral-50 border border-neutral-100 rounded p-2 overflow-x-auto max-h-32">
                {ex.rawJson}
              </pre>
            </div>
          </li>
        ))}
        {extractions.length === 0 && <p className="text-neutral-500 text-sm">No extractions yet.</p>}
      </ul>
    </div>
  );
}
