"use client";

import { useState } from "react";

const REQUIRED_CONFIRM_TEXT = "RESTORE";

export function BackupRestoreClient() {
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [mismatchMessage, setMismatchMessage] = useState<string | null>(null);
  const [forceAcknowledged, setForceAcknowledged] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [restoreResult, setRestoreResult] = useState<{ tablesRestored: number } | null>(null);

  function resetRestoreState() {
    setRestoreFile(null);
    setConfirmText("");
    setMismatchMessage(null);
    setForceAcknowledged(false);
  }

  async function runRestore(force: boolean) {
    if (!restoreFile) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const text = await restoreFile.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setRestoreError("That file isn't valid JSON.");
        return;
      }

      const res = await fetch("/api/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backup: parsed, force }),
      });
      const data = await res.json();

      if (res.status === 409 && data.error === "schema_mismatch") {
        setMismatchMessage(data.message);
        return;
      }
      if (!res.ok) {
        setRestoreError(data.message ?? data.error ?? "Restore failed.");
        return;
      }

      setRestoreResult({ tablesRestored: data.tablesRestored });
      resetRestoreState();
    } finally {
      setRestoring(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreFile || confirmText !== REQUIRED_CONFIRM_TEXT) return;
    if (
      !confirm(
        "This will delete and replace every table in the database with the contents of the selected backup file. This cannot be undone. Continue?"
      )
    ) {
      return;
    }
    setRestoreResult(null);
    runRestore(false);
  }

  function handleForceRestore() {
    if (!confirm("Restore anyway despite the schema mismatch? This cannot be undone.")) return;
    setRestoreResult(null);
    runRestore(true);
  }

  const canSubmit = restoreFile !== null && confirmText === REQUIRED_CONFIRM_TEXT && !restoring;

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <h1 className="text-xl font-semibold">Backup & Restore</h1>

      <section className="flex flex-col gap-2 border border-neutral-200 rounded p-4">
        <h2 className="font-medium">Backup</h2>
        <p className="text-neutral-500 text-sm">
          Downloads every table in the database as one JSON file - everything needed to fully restore the app to
          this exact state later.
        </p>
        <a
          href="/api/backup"
          className="self-start bg-accent text-accent-contrast rounded px-4 py-2 text-sm mt-1"
        >
          Download backup
        </a>
      </section>

      <section className="flex flex-col gap-3 border border-red-200 rounded p-4">
        <h2 className="font-medium">Restore</h2>
        <p className="text-neutral-500 text-sm">
          Replaces every table in the database with the contents of a backup file. This deletes all current data
          first - there is no partial restore, and no undo once it completes.
        </p>

        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Step 1 - download a safety backup first</p>
          <a href="/api/backup" className="self-start border border-neutral-300 rounded px-3 py-1.5 text-sm">
            Download backup
          </a>
          <p className="text-neutral-400 text-xs">
            Strongly recommended - once you restore, whatever the database held before is gone unless you have this.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="restoreFile" className="text-sm font-medium">
              Step 2 - choose a backup file
            </label>
            <input
              id="restoreFile"
              type="file"
              accept="application/json"
              onChange={(e) => {
                setRestoreFile(e.target.files?.[0] ?? null);
                setMismatchMessage(null);
                setRestoreError(null);
                setRestoreResult(null);
              }}
              className="border border-neutral-300 rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="confirmText" className="text-sm font-medium">
              Step 3 - type RESTORE to confirm
            </label>
            <input
              id="confirmText"
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="RESTORE"
              className="border border-neutral-300 rounded px-3 py-2 text-sm w-40"
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="self-start bg-red-600 text-white rounded px-4 py-2 text-sm disabled:opacity-50"
          >
            {restoring ? "Restoring…" : "Restore"}
          </button>
        </form>

        {mismatchMessage && (
          <div className="border border-amber-300 bg-amber-50 rounded p-3 flex flex-col gap-2 text-sm">
            <p>{mismatchMessage}</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={forceAcknowledged} onChange={(e) => setForceAcknowledged(e.target.checked)} />
              I understand this may not restore cleanly
            </label>
            <button
              type="button"
              disabled={!forceAcknowledged || restoring}
              onClick={handleForceRestore}
              className="self-start border border-red-400 text-red-700 rounded px-3 py-1.5 text-sm disabled:opacity-50"
            >
              {restoring ? "Restoring…" : "Restore anyway"}
            </button>
          </div>
        )}

        {restoreError && <p className="text-red-600 text-sm">{restoreError}</p>}
        {restoreResult && (
          <p className="text-green-700 text-sm">Restore complete - {restoreResult.tablesRestored} table(s) replaced.</p>
        )}
      </section>

      <section className="flex flex-col gap-2 border border-neutral-200 rounded p-4">
        <h2 className="font-medium">Export to Excel</h2>
        <p className="text-neutral-500 text-sm">
          Downloads a single .xlsx file with one sheet per meaningful data table - readable directly in Excel, or
          importable into Google Sheets via File → Import → Upload.
        </p>
        <a
          href="/api/export/all"
          className="self-start border border-neutral-300 rounded px-4 py-2 text-sm mt-1"
        >
          Download Excel export
        </a>
      </section>
    </div>
  );
}
