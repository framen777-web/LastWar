"use client";

import { useState } from "react";
import { ProgressBar } from "@/components/ProgressBar";
import { parseCsv } from "@/lib/importCsv/parseCsv";
import type { ImportMapping } from "@/lib/importCsv/types";
import { CategoryForm, type Category } from "@/components/CategoryForm";

type Step = "upload" | "map" | "preview" | "done";

type ColumnTarget =
  | { kind: "ignore" }
  | { kind: "member" }
  | { kind: "week" }
  | { kind: "category"; categoryKey: string; divisor: number }
  | { kind: "squad"; field: "air" | "tank" | "missile" | "fourth" }
  | { kind: "custom"; categoryKey: string; divisor: number }
  | { kind: "allianceRank" };

type PreviewResult = {
  totalRows: number;
  weeksFound: number[];
  matchedMembers: { raw: string; matchedName: string }[];
  newMembers: string[];
  allMembers: { id: number; name: string }[];
  sampleRows: { memberName: string; weekNumber: number; values: Record<string, number>; squads: unknown }[];
  collisions: number;
};

const CREATE_NEW = "__new__";

type CommitResult = {
  rowsProcessed: number;
  weeklyStatsWritten: number;
  weeklyStatsSkipped: number;
  categoryRecordsWritten: number;
  categoryRecordsSkipped: number;
  newMembersCreated: string[];
  weeksTouched: number[];
  allianceRanksUpdated: number;
};

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function guessCategoryForHeader(header: string, categories: Category[]): Category | null {
  const normalized = normalizeHeader(header);
  return (
    categories.find((c) => normalizeHeader(c.name) === normalized || normalizeHeader(c.key) === normalized) ?? null
  );
}

function toImportMapping(headers: string[], targets: Record<string, ColumnTarget>): ImportMapping {
  let memberColumn = "";
  let weekColumn = "";
  let allianceRankColumn: string | undefined;
  const categoryMappings: ImportMapping["categoryMappings"] = [];
  const customFields: ImportMapping["customFields"] = [];
  const squadsMapping: NonNullable<ImportMapping["squadsMapping"]> = {};

  for (const header of headers) {
    const target = targets[header];
    if (!target) continue;
    if (target.kind === "member") memberColumn = header;
    else if (target.kind === "week") weekColumn = header;
    else if (target.kind === "allianceRank") allianceRankColumn = header;
    else if (target.kind === "category") categoryMappings.push({ categoryKey: target.categoryKey, column: header, divisor: target.divisor });
    else if (target.kind === "custom") customFields.push({ categoryKey: target.categoryKey, column: header, divisor: target.divisor });
    else if (target.kind === "squad") squadsMapping[target.field] = header;
  }

  return { memberColumn, weekColumn, allianceRankColumn, categoryMappings, squadsMapping, customFields };
}

export function ImportHistoryClient() {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const [categories, setCategories] = useState<Category[]>([]);
  const [targets, setTargets] = useState<Record<string, ColumnTarget>>({});
  const [weekFrom, setWeekFrom] = useState("");
  const [weekTo, setWeekTo] = useState("");
  const [newCategoryForColumn, setNewCategoryForColumn] = useState<string | null>(null);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, number | null>>({});
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadCategories(): Promise<Category[]> {
    const res = await fetch("/api/categories");
    const data = await res.json();
    const active: Category[] = (data.categories ?? []).filter((c: Category) => c.active);
    setCategories(active);
    return active;
  }

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

    const loadedCategories = await loadCategories();

    // Pre-guess mappings by header name.
    const initialTargets: Record<string, ColumnTarget> = {};
    for (const header of parsedHeaders) {
      const lower = header.toLowerCase();
      if (lower.includes("member") || lower.includes("name")) {
        initialTargets[header] = { kind: "member" };
        continue;
      }
      if (lower === "week" || lower.includes("week")) {
        initialTargets[header] = { kind: "week" };
        continue;
      }
      if (lower.includes("rank")) {
        initialTargets[header] = { kind: "allianceRank" };
        continue;
      }
      const guessedCategory = guessCategoryForHeader(header, loadedCategories);
      if (guessedCategory && guessedCategory.shape !== "free_text") {
        initialTargets[header] = { kind: "category", categoryKey: guessedCategory.key, divisor: guessedCategory.divisor };
        continue;
      }
      initialTargets[header] = { kind: "ignore" };
    }
    setTargets(initialTargets);
    setStep("map");
  }

  function setTarget(header: string, target: ColumnTarget) {
    setTargets((prev) => {
      const next = { ...prev };
      // member/week/allianceRank are each unique - clear from any other column first.
      if (target.kind === "member" || target.kind === "week" || target.kind === "allianceRank") {
        for (const h of Object.keys(next)) {
          if (next[h]?.kind === target.kind) next[h] = { kind: "ignore" };
        }
      }
      next[header] = target;
      return next;
    });
  }

  function handleTargetSelect(header: string, value: string) {
    if (value === "__new_category__") {
      setNewCategoryForColumn(header);
      return;
    }
    if (value === "ignore") return setTarget(header, { kind: "ignore" });
    if (value === "member") return setTarget(header, { kind: "member" });
    if (value === "week") return setTarget(header, { kind: "week" });
    if (value === "allianceRank") return setTarget(header, { kind: "allianceRank" });
    if (value.startsWith("squad:")) {
      const field = value.slice("squad:".length) as "air" | "tank" | "missile" | "fourth";
      return setTarget(header, { kind: "squad", field });
    }
    if (value.startsWith("category:")) {
      const key = value.slice("category:".length);
      const cat = categories.find((c) => c.key === key);
      return setTarget(header, { kind: "category", categoryKey: key, divisor: cat?.divisor ?? 1 });
    }
    if (value === "custom") {
      return setTarget(header, { kind: "custom", categoryKey: "", divisor: 1 });
    }
  }

  function updateDivisor(header: string, divisor: number) {
    setTargets((prev) => {
      const t = prev[header];
      if (!t || (t.kind !== "category" && t.kind !== "custom")) return prev;
      return { ...prev, [header]: { ...t, divisor } };
    });
  }

  function updateCustomKey(header: string, categoryKey: string) {
    setTargets((prev) => {
      const t = prev[header];
      if (!t || t.kind !== "custom") return prev;
      return { ...prev, [header]: { ...t, categoryKey } };
    });
  }

  function selectValueForTarget(target: ColumnTarget | undefined): string {
    if (!target) return "ignore";
    if (target.kind === "category") return `category:${target.categoryKey}`;
    if (target.kind === "squad") return `squad:${target.field}`;
    return target.kind;
  }

  const mapping: ImportMapping = {
    ...toImportMapping(headers, targets),
    weekFrom: weekFrom ? Number(weekFrom) : undefined,
    weekTo: weekTo ? Number(weekTo) : undefined,
  };

  const readyForPreview = mapping.memberColumn !== "" && mapping.weekColumn !== "";

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    setPreview(null);
    const res = await fetch("/api/import-history/preview", {
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
    const res = await fetch("/api/import-history/commit", {
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
    setTargets({});
    setPreview(null);
    setCommitResult(null);
    setError(null);
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <h1 className="text-xl font-semibold">Import History</h1>
      <p className="text-neutral-500 text-sm">
        Bulk-import weekly stats from a CSV export - map each column to a category, preview the result, then
        commit. Reusable for any spreadsheet, not just one specific format.
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

          {mapping.allianceRankColumn && (
            <p className="text-neutral-500 text-sm">
              Alliance rank is tracked per week, same as any other mapped field. Each member's current rank (shown
              elsewhere in the app) is also refreshed from whichever week is latest on record for them, so importing
              older weeks after newer data already exists won't move it backwards.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-neutral-300 text-left">
                  <th className="py-2 pr-3">CSV column</th>
                  <th className="py-2 pr-3">Maps to</th>
                  <th className="py-2 pr-3">Divisor</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => {
                  const target = targets[header];
                  return (
                    <tr key={header} className="border-b border-neutral-100">
                      <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{header}</td>
                      <td className="py-1.5 pr-3">
                        <select
                          value={selectValueForTarget(target)}
                          onChange={(e) => handleTargetSelect(header, e.target.value)}
                          className="border border-neutral-300 rounded px-2 py-1"
                        >
                          <option value="ignore">— ignore —</option>
                          <option value="member">Member name</option>
                          <option value="week">Week number</option>
                          <option value="allianceRank">Alliance rank</option>
                          <optgroup label="Categories">
                            {categories
                              .filter((c) => c.shape !== "free_text")
                              .map((c) => (
                                <option key={c.key} value={`category:${c.key}`}>
                                  {c.name}
                                </option>
                              ))}
                          </optgroup>
                          {categories.some((c) => c.key === "squads") && (
                            <optgroup label="Squads">
                              <option value="squad:air">Squads: Air</option>
                              <option value="squad:tank">Squads: Tank</option>
                              <option value="squad:missile">Squads: Missile</option>
                              <option value="squad:fourth">Squads: Fourth</option>
                            </optgroup>
                          )}
                          <option value="custom">Custom field (no category yet)…</option>
                          <option value="__new_category__">+ New category…</option>
                        </select>
                      </td>
                      <td className="py-1.5 pr-3">
                        {target?.kind === "category" && (
                          <input
                            type="number"
                            step="any"
                            value={target.divisor}
                            onChange={(e) => updateDivisor(header, Number(e.target.value) || 1)}
                            className="border border-neutral-300 rounded px-2 py-1 w-24"
                          />
                        )}
                        {target?.kind === "custom" && (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="category key, e.g. canyon_storm"
                              value={target.categoryKey}
                              onChange={(e) => updateCustomKey(header, e.target.value)}
                              className="border border-neutral-300 rounded px-2 py-1 w-40"
                            />
                            <input
                              type="number"
                              step="any"
                              value={target.divisor}
                              onChange={(e) => updateDivisor(header, Number(e.target.value) || 1)}
                              className="border border-neutral-300 rounded px-2 py-1 w-20"
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!readyForPreview && (
            <p className="text-amber-600 text-sm">Map a Member name column and a Week number column to continue.</p>
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

          {newCategoryForColumn && (
            <div className="fixed inset-0 z-20 flex justify-end bg-black/20">
              <div className="w-full max-w-md bg-surface-raised h-full overflow-y-auto p-6 flex flex-col gap-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">New category</h2>
                  <button
                    onClick={() => setNewCategoryForColumn(null)}
                    className="text-neutral-500 hover:text-neutral-900"
                  >
                    Close
                  </button>
                </div>
                <CategoryForm
                  editing={null}
                  initialName={newCategoryForColumn}
                  onCancel={() => setNewCategoryForColumn(null)}
                  onSaved={async (category) => {
                    await loadCategories();
                    setTarget(newCategoryForColumn, { kind: "category", categoryKey: category.key, divisor: category.divisor });
                    setNewCategoryForColumn(null);
                  }}
                />
              </div>
            </div>
          )}
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
              {preview.collisions} value(s) already exist for these members/weeks/categories. With "Overwrite" off,
              they'll be left untouched.
            </p>
          )}

          <div>
            <p className="text-sm font-medium mb-1">Sample of mapped rows</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-300 text-left">
                    <th className="py-1 pr-3">Member</th>
                    <th className="py-1 pr-3">Week</th>
                    {mapping.categoryMappings.map((c) => (
                      <th key={c.categoryKey} className="py-1 pr-3">{c.categoryKey}</th>
                    ))}
                    {mapping.customFields.map((c) => (
                      <th key={c.categoryKey} className="py-1 pr-3">{c.categoryKey}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100">
                      <td className="py-1 pr-3 whitespace-nowrap">{r.memberName}</td>
                      <td className="py-1 pr-3">{r.weekNumber}</td>
                      {[...mapping.categoryMappings, ...mapping.customFields].map((c) => (
                        <td key={c.categoryKey} className="py-1 pr-3">
                          {r.values[c.categoryKey] !== undefined ? r.values[c.categoryKey].toLocaleString() : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={overwriteExisting} onChange={(e) => setOverwriteExisting(e.target.checked)} />
            Overwrite existing values (default: leave them as is)
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
            <li>{commitResult.weeklyStatsWritten} values written, {commitResult.weeklyStatsSkipped} skipped (already existed)</li>
            <li>{commitResult.categoryRecordsWritten} squads records written, {commitResult.categoryRecordsSkipped} skipped</li>
            <li>Weeks touched: {commitResult.weeksTouched.join(", ")}</li>
            {commitResult.newMembersCreated.length > 0 && (
              <li>New members created: {commitResult.newMembersCreated.join(", ")}</li>
            )}
            {commitResult.allianceRanksUpdated > 0 && (
              <li>Alliance ranks updated: {commitResult.allianceRanksUpdated}</li>
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
