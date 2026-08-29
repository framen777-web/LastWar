"use client";

import { useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { parseCsv } from "@/lib/importCsv/parseCsv";

type Step = "upload" | "map" | "preview" | "done";

type PreviewResult = {
  totalRows: number;
  weeksFound: number[];
  matchedMembers: { raw: string; matchedName: string }[];
  newMembers: string[];
  allMembers: { id: number; name: string }[];
  sampleRows: { weekNumber: number; conductorName: string; points: number; passengerName: string | null }[];
  collisions: number;
};

type CommitResult = {
  rowsProcessed: number;
  roundsCreated: number;
  selectionsWritten: number;
  selectionsSkipped: number;
  newMembersCreated: string[];
  weeksTouched: number[];
};

const NONE = "__none__";
const CREATE_NEW = "__new__";

export function ImportConductorHistoryClient() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const [weekColumn, setWeekColumn] = useState("");
  const [conductorNameColumn, setConductorNameColumn] = useState("");
  const [pointsColumn, setPointsColumn] = useState("");
  const [passengerNameColumn, setPassengerNameColumn] = useState(NONE);
  const [weekFrom, setWeekFrom] = useState("");
  const [weekTo, setWeekTo] = useState("");

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, number | null>>({});
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    const text = await file.text();
    const { headers: parsedHeaders, rows } = parseCsv(text);
    if (parsedHeaders.length === 0) {
      setError("Couldn't read any columns from that file.");
      return;
    }
    setFileName(file.name);
    setCsvText(text);
    setHeaders(parsedHeaders);
    setRowCount(rows.length);

    // Pre-guess columns by header name.
    const guess = (needle: string) => parsedHeaders.find((h) => h.toLowerCase().includes(needle)) ?? "";
    setWeekColumn(guess("week"));
    setConductorNameColumn(guess("conductor") || guess("name"));
    setPointsColumn(guess("point"));
    setPassengerNameColumn(guess("passenger") || guess("vip") || NONE);

    setStep("map");
  }

  const mapping = {
    weekColumn,
    conductorNameColumn,
    pointsColumn,
    passengerNameColumn: passengerNameColumn !== NONE ? passengerNameColumn : undefined,
    weekFrom: weekFrom ? Number(weekFrom) : undefined,
    weekTo: weekTo ? Number(weekTo) : undefined,
  };

  const readyForPreview = weekColumn !== "" && conductorNameColumn !== "" && pointsColumn !== "";

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    setPreview(null);
    const res = await fetch("/api/import-conductor-history/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, mapping }),
    });
    const data = await res.json();
    setPreviewing(false);
    if (!res.ok) {
      setError(data.error ?? "Preview failed.");
      return;
    }
    setPreview(data);
    setResolutions({});
    setStep("preview");
  }

  async function handleCommit() {
    setError(null);
    setCommitting(true);
    const res = await fetch("/api/import-conductor-history/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, mapping, overwriteExisting, resolutions }),
    });
    const data = await res.json();
    setCommitting(false);
    if (!res.ok) {
      setError(data.error ?? "Import failed.");
      return;
    }
    setCommitResult(data);
    setStep("done");
  }

  function startOver() {
    setStep("upload");
    setFileName("");
    setCsvText("");
    setHeaders([]);
    setPreview(null);
    setCommitResult(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Import Conductor History</h1>
      <p className="text-neutral-500 text-sm">
        Backfill past Conductor/Passenger selections from a spreadsheet export, so History shows real past rounds
        and Standings correctly reflect who was already selected (and zeroed) before this feature existed. There's
        no reliable day-of-week in spreadsheet history, so rows are assigned to days in the order they appear for
        each week - this only affects which weekday label shows for old rounds, not points or standings.
      </p>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {step === "upload" && (
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">CSV file</label>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
            className="border border-neutral-300 rounded px-3 py-2"
          />
        </div>
      )}

      {step === "map" && (
        <div className="flex flex-col gap-4">
          <p className="text-neutral-500 text-sm">
            {fileName} · {rowCount} rows · {headers.length} columns
          </p>

          <div className="flex flex-col gap-3 max-w-sm">
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="font-medium">Week column</label>
              <select value={weekColumn} onChange={(e) => setWeekColumn(e.target.value)} className="border border-neutral-300 rounded px-2 py-1">
                <option value="">Select…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="font-medium">Conductor name column</label>
              <select value={conductorNameColumn} onChange={(e) => setConductorNameColumn(e.target.value)} className="border border-neutral-300 rounded px-2 py-1">
                <option value="">Select…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="font-medium">Points column</label>
              <select value={pointsColumn} onChange={(e) => setPointsColumn(e.target.value)} className="border border-neutral-300 rounded px-2 py-1">
                <option value="">Select…</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between gap-3 text-sm">
              <label className="font-medium">Passenger name column</label>
              <select value={passengerNameColumn} onChange={(e) => setPassengerNameColumn(e.target.value)} className="border border-neutral-300 rounded px-2 py-1">
                <option value={NONE}>— none —</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <label className="font-medium">Only import weeks</label>
            <input
              type="number"
              placeholder="from"
              value={weekFrom}
              onChange={(e) => setWeekFrom(e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1 w-20"
            />
            <span>to</span>
            <input
              type="number"
              placeholder="to"
              value={weekTo}
              onChange={(e) => setWeekTo(e.target.value)}
              className="border border-neutral-300 rounded px-2 py-1 w-20"
            />
            <span className="text-neutral-400 text-xs">(leave blank for no limit)</span>
          </div>

          {!readyForPreview && (
            <p className="text-amber-600 text-sm">Map a Week column, Conductor name column, and Points column to continue.</p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handlePreview}
              disabled={!readyForPreview || previewing}
              className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {previewing ? "Checking…" : "Preview"}
            </button>
            <button onClick={startOver} className="border border-neutral-300 rounded px-4 py-2 text-sm">
              Start over
            </button>
          </div>
        </div>
      )}

      {step === "preview" && preview && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="border border-neutral-200 rounded p-3">
              <div className="text-neutral-500 text-xs">Rows in range</div>
              <div className="text-lg font-semibold">{preview.totalRows}</div>
            </div>
            <div className="border border-neutral-200 rounded p-3">
              <div className="text-neutral-500 text-xs">Weeks</div>
              <div className="text-lg font-semibold">
                {preview.weeksFound.length > 0 ? `${preview.weeksFound[0]}–${preview.weeksFound[preview.weeksFound.length - 1]}` : "—"}
              </div>
            </div>
            <div className="border border-neutral-200 rounded p-3">
              <div className="text-neutral-500 text-xs">Matched members</div>
              <div className="text-lg font-semibold">{preview.matchedMembers.length}</div>
            </div>
            <div className="border border-neutral-200 rounded p-3">
              <div className="text-neutral-500 text-xs">New members</div>
              <div className="text-lg font-semibold">{preview.newMembers.length}</div>
            </div>
          </div>

          {preview.newMembers.length > 0 && (
            <div className="border border-amber-200 bg-amber-50 rounded p-3 text-sm flex flex-col gap-2">
              <p className="font-medium text-amber-800">
                These names didn&apos;t match anyone - create as new, or pick who they renamed from:
              </p>
              {preview.newMembers.map((name) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-amber-800 w-40 truncate" title={name}>
                    {name}
                  </span>
                  <select
                    value={resolutions[name] ?? CREATE_NEW}
                    onChange={(e) =>
                      setResolutions((r) => ({ ...r, [name]: e.target.value === CREATE_NEW ? null : Number(e.target.value) }))
                    }
                    className="border border-neutral-300 rounded px-2 py-1 text-xs"
                  >
                    <option value={CREATE_NEW}>Create as new member</option>
                    <optgroup label="Rename of existing member…">
                      {preview.allMembers.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </div>
              ))}
            </div>
          )}

          {preview.collisions > 0 && (
            <p className="text-amber-600 text-sm">
              {preview.collisions} selection(s) already exist for these weeks/days/roles. With "Overwrite" off,
              they'll be left untouched.
            </p>
          )}

          <div>
            <p className="text-sm font-medium mb-1">Sample of mapped rows</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-300 text-left">
                    <th className="py-1 pr-3">Week</th>
                    <th className="py-1 pr-3">Conductor</th>
                    <th className="py-1 pr-3">Points</th>
                    <th className="py-1 pr-3">Passenger</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100">
                      <td className="py-1 pr-3">{r.weekNumber}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{r.conductorName}</td>
                      <td className="py-1 pr-3">{r.points.toLocaleString()}</td>
                      <td className="py-1 pr-3 whitespace-nowrap">{r.passengerName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overwriteExisting} onChange={(e) => setOverwriteExisting(e.target.checked)} />
            Overwrite existing selections (default: leave them as is)
          </label>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCommit}
              disabled={committing}
              className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {committing ? "Importing…" : `Commit import (${preview.totalRows} rows)`}
            </button>
            <button onClick={() => setStep("map")} className="border border-neutral-300 rounded px-4 py-2 text-sm">
              Back to mapping
            </button>
          </div>
          {committing && <ProgressBar className="max-w-xs" />}
        </div>
      )}

      {step === "done" && commitResult && (
        <div className="flex flex-col gap-3">
          <p className="text-green-700 text-sm font-medium">Import complete.</p>
          <ul className="text-sm text-neutral-700 list-disc pl-5 flex flex-col gap-1">
            <li>{commitResult.rowsProcessed} rows processed</li>
            <li>{commitResult.roundsCreated} rounds created</li>
            <li>{commitResult.selectionsWritten} selections written, {commitResult.selectionsSkipped} skipped (already existed)</li>
            <li>Weeks touched: {commitResult.weeksTouched.join(", ")}</li>
            {commitResult.newMembersCreated.length > 0 && (
              <li>New members created: {commitResult.newMembersCreated.join(", ")}</li>
            )}
          </ul>
          <button onClick={startOver} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm self-start">
            Import another file
          </button>
        </div>
      )}
    </div>
  );
}
