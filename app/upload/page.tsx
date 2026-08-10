"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PipelineResult = {
  filename: string;
  categoryKey: string;
  confidence: number;
  status: "committed" | "needs_review" | "pending_confirmation" | "error";
  message?: string;
};

const STATUS_STYLES: Record<PipelineResult["status"], string> = {
  committed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  pending_confirmation: "bg-blue-100 text-blue-800",
  error: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<PipelineResult["status"], string> = {
  committed: "committed",
  needs_review: "needs review",
  pending_confirmation: "needs your confirmation — see Review",
  error: "error",
};

export default function UploadPage() {
  const [knownWeeks, setKnownWeeks] = useState<number[]>([]);
  const [weekNumber, setWeekNumber] = useState<number>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<PipelineResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/weeks")
      .then((res) => res.json())
      .then((data: { weeks: number[]; defaultWeek: number }) => {
        setKnownWeeks(data.weeks);
        setWeekNumber(data.defaultWeek);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;

    setSubmitting(true);
    setError(null);
    setResults(null);

    try {
      const formData = new FormData();
      formData.set("weekNumber", String(weekNumber));
      for (const file of files) formData.append("files", file);

      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Upload failed");
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Import</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="weekNumber" className="text-sm font-medium">
            Week number
          </label>
          <input
            id="weekNumber"
            type="number"
            min={1}
            list="known-weeks"
            value={weekNumber}
            onChange={(e) => setWeekNumber(Number(e.target.value))}
            className="border border-neutral-300 rounded px-3 py-2 w-32"
          />
          <datalist id="known-weeks">
            {knownWeeks.map((w) => (
              <option key={w} value={w} />
            ))}
          </datalist>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="files" className="text-sm font-medium">
            Screenshots
          </label>
          <input
            id="files"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          {files.length > 0 && (
            <p className="text-sm text-neutral-500">{files.length} file(s) selected</p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting || files.length === 0}
          className="self-start bg-neutral-900 text-white rounded px-4 py-2 disabled:opacity-50"
        >
          {submitting ? "Processing…" : "Upload & process"}
        </button>
      </form>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {results && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Results</h2>

          {results.some((r) => r.status === "pending_confirmation") && (
            <Link
              href="/review"
              className="bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-2 text-sm hover:bg-blue-100"
            >
              Some imports need your confirmation before they count — go to Review →
            </Link>
          )}

          <ul className="flex flex-col gap-2">
            {results.map((r, i) => (
              <li
                key={i}
                className="border border-neutral-200 rounded px-3 py-2 flex items-center justify-between gap-3 text-sm"
              >
                <span className="truncate flex-1">{r.filename.split("/").pop()}</span>
                <span className="text-neutral-500">{r.categoryKey}</span>
                <span className="text-neutral-500">{Math.round(r.confidence * 100)}%</span>
                {r.status === "pending_confirmation" ? (
                  <Link
                    href="/review"
                    className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.status]} hover:underline`}
                  >
                    {STATUS_LABELS[r.status]}
                  </Link>
                ) : (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
