"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UnconfirmButton({ roundId }: { roundId: number }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnconfirm() {
    if (
      !confirm(
        "Revert this round back to draft? Every member's points balance frozen by this confirmation goes back to what it was before - the round itself stays around as an editable draft, it won't be deleted."
      )
    ) {
      return;
    }
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/conductor/rounds/${roundId}/confirm`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Failed to revert this round.");
      setRunning(false);
      return;
    }
    router.push("/conductor/select");
  }

  return (
    <div className="flex flex-col gap-2 items-start">
      <button
        onClick={handleUnconfirm}
        disabled={running}
        className="border border-red-300 text-red-700 rounded px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {running ? "Reverting…" : "Revert to draft"}
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}
