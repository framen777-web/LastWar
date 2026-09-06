"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { upload } from "@vercel/blob/client";
import { useNavigationBlocker } from "@/components/NavigationBlocker";
import { ProgressBar } from "@/components/ProgressBar";

const LEAVE_WARNING =
  "The import keeps running on the server even if you leave this page, switch to another app, or close your browser entirely - but you won't be able to see live progress or results here once you go. Check Review (or the dashboards) afterwards to see how it went. Leave anyway?";

type ImportItemStatus = "queued" | "processing" | "done";
type ResultStatus = "committed" | "needs_review" | "pending_confirmation" | "error";

type ImportItem = {
  filename: string;
  status: ImportItemStatus;
  categoryKey: string | null;
  confidence: number | null;
  resultStatus: ResultStatus | null;
  errorMessage: string | null;
};

type ImportJobStatus = {
  jobId: number;
  status: "processing" | "completed" | "cancelled";
  totalFiles: number;
  processedFiles: number;
  items: ImportItem[];
};

const STATUS_STYLES: Record<ResultStatus, string> = {
  committed: "bg-green-100 text-green-800",
  needs_review: "bg-amber-100 text-amber-800",
  pending_confirmation: "bg-blue-100 text-blue-800",
  error: "bg-red-100 text-red-800",
};

const STATUS_LABELS: Record<ResultStatus, string> = {
  committed: "committed",
  needs_review: "needs review — see Review",
  pending_confirmation: "needs your confirmation — see Review",
  error: "error — see Review",
};

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - a phone screenshot is a few MB at most
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const POLL_INTERVAL_MS = 1500;
const UPLOAD_CONCURRENCY = 3;

async function uploadFilesToJob(files: File[], jobId: number): Promise<{ filename: string; error: string }[]> {
  const queue = [...files];
  const failures: { filename: string; error: string }[] = [];

  async function worker() {
    while (queue.length > 0) {
      const file = queue.shift();
      if (!file) return;
      try {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/import/blob-upload",
        });
        const res = await fetch(`/api/import/${jobId}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, blobUrl: blob.url, mimeType: file.type || "image/png" }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
      } catch (err) {
        failures.push({ filename: file.name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () => worker()));
  return failures;
}

export function UploadClient() {
  const [knownWeeks, setKnownWeeks] = useState<number[]>([]);
  const [weekNumber, setWeekNumber] = useState<number>(1);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
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

    // Nudges any import that got interrupted mid-batch back into motion the moment someone
    // reopens this page. The real safety net is the external cron hitting
    // /api/import/resume on a schedule regardless of whether the app is open at all - this
    // is just a faster path for the common case of reopening it yourself.
    fetch("/api/import/resume", { method: "POST" }).catch(() => {});
  }, []);

  // Clears the navigation block if this component unmounts while it's still set - e.g. the
  // user confirmed the "leave anyway?" prompt and actually navigated away while an import
  // was still in flight. Without this, isBlocked stays stuck true in
  // NavigationBlockerProvider's app-wide state forever afterward (nothing else ever turns
  // it back off once this component is gone), so every future in-app navigation ANYWHERE
  // else in the app incorrectly shows this page's "leave anyway?" prompt too.
  useEffect(() => {
    return () => setBlock(false);
  }, [setBlock]);

  // Covers an actual tab close/refresh/typed URL - in-app navigation (NavHeader's Back/Home)
  // goes through useNavigationBlocker instead, since beforeunload doesn't fire for Next.js
  // client-side route changes. The import no longer depends on this tab staying open at
  // all (see LEAVE_WARNING) - this is purely about the live view being lost.
  useEffect(() => {
    if (!submitting) return;
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [submitting]);

  // Polls while a job is in flight. Deliberately keeps polling even when the tab is
  // hidden/backgrounded (no visibilitychange gating) - if the browser throttles or fully
  // suspends this timer while backgrounded, that only pauses the LIVE VIEW; the import
  // itself keeps running server-side regardless, and this just picks back up (or shows the
  // final state) whenever the tab becomes active again.
  useEffect(() => {
    if (jobId === null) return;

    async function poll() {
      try {
        const res = await fetch(`/api/import/${jobId}/status`);
        if (!res.ok) return;
        const data: ImportJobStatus = await res.json();
        setJob(data);
        if (data.status !== "processing") {
          setSubmitting(false);
          setBlock(false);
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch {
        // Transient network hiccup - next tick tries again.
      }
    }

    poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [jobId, setBlock]);

  async function handleCancel() {
    if (jobId === null) return;
    try {
      await fetch(`/api/import/${jobId}/cancel`, { method: "POST" });
    } catch {
      // Best-effort - the resume safety net will just find nothing left queued.
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;

    setSubmitting(true);
    setError(null);
    setJob(null);
    setJobId(null);
    setBlock(true, LEAVE_WARNING);

    try {
      const startRes = await fetch("/api/import/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekNumber, totalFiles: files.length }),
      });
      const startData = await startRes.json();
      if (!startRes.ok) throw new Error(startData.error ?? `HTTP ${startRes.status}`);

      const newJobId: number = startData.jobId;
      setJobId(newJobId); // status polling starts immediately - items will appear as each upload finishes

      const failures = await uploadFilesToJob(files, newJobId);
      if (failures.length > 0) {
        setError(
          `${failures.length} of ${files.length} file(s) failed to upload:\n${failures
            .map((f) => `${f.filename}: ${f.error}`)
            .join("\n")}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      setBlock(false);
    }
  }

  const results = job?.items.filter((i) => i.status === "done") ?? [];

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
              setJob(null);
              setJobId(null);
              setError(rejections.length > 0 ? rejections.join("\n") : null);
            }}
            className="border border-neutral-300 rounded px-3 py-2"
          />
          {files.length > 0 && <p className="text-sm text-neutral-500">{files.length} file(s) selected</p>}
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
          {job && (
            <div className="flex flex-col gap-1">
              <span className="text-sm text-neutral-500">
                {job.status === "processing"
                  ? `Busy with file ${Math.min(job.processedFiles + 1, job.totalFiles)} of ${job.totalFiles}`
                  : job.status === "cancelled"
                    ? `Cancelled after ${job.processedFiles} of ${job.totalFiles} file(s)`
                    : `Done - ${job.processedFiles} of ${job.totalFiles} file(s)`}
              </span>
              <ProgressBar value={job.totalFiles > 0 ? job.processedFiles / job.totalFiles : 0} className="max-w-xs" />
            </div>
          )}
        </div>
      </form>

      {error && <p className="text-red-600 text-sm whitespace-pre-line">{error}</p>}

      {results.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="font-medium">Results</h2>

          {results.some((r) => r.resultStatus === "pending_confirmation") && (
            <Link
              href="/review"
              className="bg-blue-50 border border-blue-200 text-blue-800 rounded px-3 py-2 text-sm hover:bg-blue-100"
            >
              Some imports need your confirmation before they count — go to Review →
            </Link>
          )}

          <ul className="flex flex-col gap-2">
            {results.map((r, i) => (
              <li key={i} className="border border-neutral-200 rounded px-3 py-2 flex items-center justify-between gap-3 text-sm">
                <span className="truncate flex-1">{r.filename}</span>
                <span className="text-neutral-500">{r.categoryKey}</span>
                <span className="text-neutral-500">{r.confidence !== null ? `${Math.round(r.confidence * 100)}%` : ""}</span>
                {r.resultStatus &&
                  (r.resultStatus === "pending_confirmation" || r.resultStatus === "needs_review" || r.resultStatus === "error" ? (
                    <Link
                      href="/review"
                      className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]} hover:underline`}
                    >
                      {STATUS_LABELS[r.resultStatus]}
                    </Link>
                  ) : (
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[r.resultStatus]}`}>
                      {STATUS_LABELS[r.resultStatus]}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
