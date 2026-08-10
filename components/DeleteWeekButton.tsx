"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteWeekButton({ weekNumber, recordCount }: { weekNumber: number; recordCount: number }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const proceed = confirm(
      `Delete all Weekly Info data for week ${weekNumber}? This removes ${recordCount} record(s) (Weekly Info + Multitable) for that week. Raw uploaded images and their extraction history are not affected. This cannot be undone.`
    );
    if (!proceed) return;

    setDeleting(true);
    await fetch(`/api/weeks/${weekNumber}`, { method: "DELETE" });
    setDeleting(false);
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={deleting}
      className="border border-red-300 text-red-700 rounded px-3 py-1 text-sm hover:bg-red-50 disabled:opacity-50"
    >
      {deleting ? "Deleting…" : `Delete week ${weekNumber}`}
    </button>
  );
}
