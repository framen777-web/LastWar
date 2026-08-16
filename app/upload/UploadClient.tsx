"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useNavigationBlocker } from "@/components/NavigationBlocker";

const LEAVE_WARNING =
  "An upload is still processing. Leaving won't stop it - files already queued keep uploading in the background - but you'll lose the progress and results view. Leave anyway?";

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

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - a phone screenshot is a few MB at most
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function UploadClient() {
  const [knownWeeks, setKnownWeeks] = useState<number[]>([]);
  const [weekNumber, setWeekNumber] = useState<number>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [results, setResults] = useState<PipelineResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const { setBlock } = useNavigationBlocker();

  useEffect(() => {
    fetch("/api/weeks")
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load weeks (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: { weeks: number[]; defaultWeek: number }) => {
        setKnownWeeks(data.weeks);
        setWeekNumber(data.defaultWeek);
      })
      .catch((err) => {
        setError(`Could not load known week numbers: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, []);

  // Covers an actual tab close/refresh/typed URL - in-app navigation (NavHeader's Back/Home)
  // goes through useNavigationBlocker instead, since beforeunload doesn't fire for Next.js
  // client-side route changes.
  useEffect(() => {
    if (!submitting) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submitting]);

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;

    setSubmitting(true);
    setError(null);
    setResults(null);
    setBlock(true, LEAVE_WARNING);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Processed one file per request (not one batch request) so the button can show
    // real "file X of N" progress instead of a single opaque "Processing…" for the
    // whole upload - each file already runs independently server-side. A failure on
    // one file doesn't stop the rest - they're independent requests, so partial success
    // is the normal case, not an error condition to abort on.
    const collected: PipelineResult[] = [];
    const failed: { filename: string; reason: string }[] = [];
    let completed = 0;
    let cancelled = false;
    try {
      for (let i = 0; i < files.length; i++) {
        if (controller.signal.aborted) {
          cancelled = true;
          break;
        }
        setProgress({ current: i + 1, total: files.length });
        const file = files[i];

        try {
          const formData = new FormData();
          formData.set("weekNumber", String(weekNumber));
          formData.append("files", file);

          const res = await fetch("/api/upload", { method: "POST", body: formData, signal: controller.signal });
          const data = await res.json();

          if (!res.ok) {
            failed.push({ filename: file.name, reason: data.error ?? `HTTP ${res.status}` });
            continue;
          }
          collected.push(...data.results);
        } catch (err) {
          if (err instanceof DOMException && err.name === "AbortError") {
            cancelled = true;
            break;
          }
          failed.push({ filename: file.name, reason: err instanceof Error ? err.message : String(err) });
        } finally {
          completed++;
        }
      }
      setResults(collected.length > 0 ? collected : null);

      const messages: string[] = [];
      if (cancelled) {
        messages.push(`Cancelled - ${completed} of ${files.length} file(s) were attempted before stopping.`);
      }
      if (failed.length > 0) {
        messages.push(`${failed.length} of ${files.length} file(s) failed:\n${failed.map((f) => `${f.filename}: ${f.reason}`).join("\n")}`);
      }
      if (messages.length > 0) setError(messages.join("\n\n"));
    } finally {
      setSubmitting(false);
      setProgress(null);
      setBlock(false);
      abortControllerRef.current = null;
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
            onChange={(e) => {
              const selected = Array.from(e.target.files ?? []);
              const valid: File[] = [];
              const rejections: string[] = [];

              for (const file of selected) {
                if (file.size > MAX_FILE_SIZE) {
                  rejections.push(`${file.name}: ${Math.round(file.size / 1024 / 1024)}MB exceeds the 10MB limit`);
                } else if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                  rejections.push(`${file.name}: unsupported type "${file.type || "unknown"}" (use JPEG, PNG, or WebP)`);
                } else {
                  valid.push(file);
                }
              }

              setFiles(valid);
              setResults(null);
              setError(rejections.length > 0 ? rejections.join("\n") : null);
            }}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          {files.length > 0 && (
            <p className="text-sm text-neutral-500">{files.length} file(s) selected</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || files.length === 0}
            className="self-start bg-accent text-accent-contrast rounded px-4 py-2 disabled:opacity-50"
          >
            {submitting ? "Processing…" : "Upload & process"}
          </button>
          {submitting && (
            <button
              type="button"
              onClick={handleCancel}
              className="border border-neutral-300 rounded px-4 py-2 hover:bg-neutral-50"
            >
              Cancel
            </button>
          )}
          {progress && (
            <span className="text-sm text-neutral-500">
              Busy with file {progress.current} of {progress.total}
            </span>
          )}
        </div>
      </form>

      {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}

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
