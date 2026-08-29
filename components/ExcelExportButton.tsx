"use client";

import { useState } from "react";
import { ProgressBar } from "./ProgressBar";

export function ExcelExportButton({ href, label = "Export to Excel", className = "" }: { href: string; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        setError("Export failed.");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "export.xlsx";

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Export failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
      >
        {busy ? "Preparing…" : label}
      </button>
      {busy && <ProgressBar className="max-w-[200px]" />}
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}
