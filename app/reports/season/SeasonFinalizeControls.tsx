"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// ADMIN-only controls, rendered by the page only when user.role === "ADMIN" - this component
// assumes that gate has already happened and never checks role itself. Lives on Season Reports
// (not Season Setup) since finalizing/reopening is a "run it" action for whoever's watching the
// season, not a config-editing step - see spec section 0.
export function SeasonFinalizeControls({
  seasonId,
  status,
  finalizedAt,
}: {
  seasonId: number;
  status: string;
  finalizedAt: Date | null;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = status === "final";

  async function handleFinalize() {
    if (
      !confirm(
        "This locks scoring config and freezes the current results as the official reward list. You can reopen it later if needed."
      )
    )
      return;
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/finalize`, { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Finalize failed.");
      return;
    }
    router.refresh();
  }

  async function handleReopen() {
    if (!confirm("This deletes the frozen results - the report will show live numbers again until you re-finalize.")) return;
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/seasons/${seasonId}/reopen`, { method: "POST" });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Reopen failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="border border-neutral-200 rounded p-4 flex flex-col gap-3 max-w-xl">
      <div className="font-semibold">{locked ? "Finalized" : "Finalize"}</div>
      {locked ? (
        <>
          <p className="text-neutral-500 text-sm">
            Finalized{finalizedAt ? ` on ${new Date(finalizedAt).toLocaleString()}` : ""}. This report reads the frozen result rows -
            reopen to unlock scoring config and go back to live numbers.
          </p>
          <button
            onClick={handleReopen}
            disabled={running}
            className="border border-neutral-300 rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {running ? "Reopening…" : "Reopen for editing"}
          </button>
        </>
      ) : (
        <>
          <p className="text-neutral-500 text-sm">
            Freezes the current live standings as this season&apos;s official reward list. Scoring config and bands are
            locked from further edits until reopened.
          </p>
          <button
            onClick={handleFinalize}
            disabled={running}
            className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50 self-start"
          >
            {running ? "Finalizing…" : "Finalize season"}
          </button>
        </>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
