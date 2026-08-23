"use client";

import { useState } from "react";
import Link from "next/link";
import { parseCsv } from "@/lib/importCsv/parseCsv";

type Step = "upload" | "map" | "preview" | "done";

type ExtraItem = { id: number; key: string; name: string };

type ColumnTarget = { kind: "ignore" } | { kind: "member" } | { kind: "item"; itemKey: string };

type PreviewResult = {
  totalRows: number;
  matchedMembers: { raw: string; matchedName: string }[];
  newMembers: string[];
  allMembers: { id: number; name: string }[];
  sampleRows: { memberName: string; values: Record<string, number> }[];
};

const CREATE_NEW = "__new__";

type CommitResult = { rowsProcessed: number; valuesWritten: number; newMembersCreated: string[] };

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function guessItemForHeader(header: string, items: ExtraItem[]): ExtraItem | null {
  const normalized = normalizeHeader(header);
  return items.find((i) => normalizeHeader(i.name) === normalized || normalizeHeader(i.key) === normalized) ?? null;
}

export function UploadExtrasClient({ seasonId }: { seasonId: number }) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [csvText, setCsvText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);

  const [items, setItems] = useState<ExtraItem[]>([]);
  const [targets, setTargets] = useState<Record<string, ColumnTarget>>({});
  const [newItemForColumn, setNewItemForColumn] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);

  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [resolutions, setResolutions] = useState<Record<string, number | null>>({});
  const [committing, setCommitting] = useState(false);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadItems(): Promise<ExtraItem[]> {
    const res = await fetch(`/api/seasons/${seasonId}`);
    const data = await res.json();
    const loaded: ExtraItem[] = data.extraItems ?? [];
    setItems(loaded);
    return loaded;
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

    const loadedItems = await loadItems();

    const initialTargets: Record<string, ColumnTarget> = {};
    for (const header of parsedHeaders) {
      const lower = header.toLowerCase();
      if (lower.includes("member") || lower.includes("name") || lower.includes("commander")) {
        initialTargets[header] = { kind: "member" };
        continue;
      }
      const guessedItem = guessItemForHeader(header, loadedItems);
      if (guessedItem) {
        initialTargets[header] = { kind: "item", itemKey: guessedItem.key };
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
      if (target.kind === "member") {
        for (const h of Object.keys(next)) {
          if (next[h]?.kind === "member") next[h] = { kind: "ignore" };
        }
      }
      next[header] = target;
      return next;
    });
  }

  function handleTargetSelect(header: string, value: string) {
    if (value === CREATE_NEW) {
      setNewItemForColumn(header);
      setNewItemName("");
      return;
    }
    if (value === "ignore") return setTarget(header, { kind: "ignore" });
    if (value === "member") return setTarget(header, { kind: "member" });
    if (value.startsWith("item:")) return setTarget(header, { kind: "item", itemKey: value.slice("item:".length) });
  }

  function selectValueForTarget(target: ColumnTarget | undefined): string {
    if (!target) return "ignore";
    if (target.kind === "item") return `item:${target.itemKey}`;
    return target.kind;
  }

  async function handleCreateItem() {
    if (!newItemName.trim() || !newItemForColumn) return;
    setCreatingItem(true);
    const res = await fetch(`/api/seasons/${seasonId}/extra-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newItemName.trim() }),
    });
    const data = await res.json();
    setCreatingItem(false);
    if (!res.ok) {
      setError(data.error ?? "Couldn't create item.");
      return;
    }
    setItems((prev) => [...prev, data.item]);
    setTarget(newItemForColumn, { kind: "item", itemKey: data.item.key });
    setNewItemForColumn(null);
    setNewItemName("");
  }

  const memberColumn = Object.entries(targets).find(([, t]) => t.kind === "member")?.[0] ?? "";
  const itemColumns: Record<string, string> = Object.fromEntries(
    Object.entries(targets).filter(([, t]) => t.kind === "item").map(([header, t]) => [header, (t as { kind: "item"; itemKey: string }).itemKey])
  );
  const readyForPreview = memberColumn !== "" && Object.keys(itemColumns).length > 0;

  async function handlePreview() {
    setError(null);
    setPreviewing(true);
    setPreview(null);
    const res = await fetch(`/api/seasons/${seasonId}/upload-extras/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, mapping: { memberColumn, itemColumns } }),
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
    const res = await fetch(`/api/seasons/${seasonId}/upload-extras/commit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csvText, mapping: { memberColumn, itemColumns }, resolutions }),
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
      <div>
        <Link href={`/setup/seasons/${seasonId}`} className="text-xs text-accent hover:underline">
          ← Season
        </Link>
        <h1 className="text-xl font-semibold">Upload extras</h1>
      </div>
      <p className="text-neutral-500 text-sm">
        Upload a one-time per-commander total for this season&apos;s specific items - map each column to an item,
        preview, then commit. Re-uploading overwrites any existing value in place.
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

          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-neutral-300 text-left">
                  <th className="py-2 pr-3">CSV column</th>
                  <th className="py-2 pr-3">Maps to</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => (
                  <tr key={header} className="border-b border-neutral-100">
                    <td className="py-1.5 pr-3 font-medium whitespace-nowrap">{header}</td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={selectValueForTarget(targets[header])}
                        onChange={(e) => handleTargetSelect(header, e.target.value)}
                        className="border border-neutral-300 rounded px-2 py-1"
                      >
                        <option value="ignore">— ignore —</option>
                        <option value="member">Member name</option>
                        <optgroup label="Items">
                          {items.map((i) => (
                            <option key={i.key} value={`item:${i.key}`}>
                              {i.name}
                            </option>
                          ))}
                        </optgroup>
                        <option value={CREATE_NEW}>+ New item…</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!readyForPreview && (
            <p className="text-amber-600 text-sm">Map a Member name column and at least one item column to continue.</p>
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

          {newItemForColumn && (
            <div className="fixed inset-0 z-20 flex justify-end bg-black/20">
              <div className="w-full max-w-sm bg-surface-raised h-full overflow-y-auto p-6 flex flex-col gap-4 shadow-xl">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">New item</h2>
                  <button onClick={() => setNewItemForColumn(null)} className="text-neutral-500 hover:text-neutral-900">
                    Close
                  </button>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-sm font-medium">Name</label>
                  <input
                    type="text"
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    className="border border-neutral-300 rounded px-3 py-2"
                    placeholder="e.g. CrystalGold"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleCreateItem}
                    disabled={creatingItem || !newItemName.trim()}
                    className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
                  >
                    {creatingItem ? "Creating…" : "Create"}
                  </button>
                  <button onClick={() => setNewItemForColumn(null)} className="border border-neutral-300 rounded px-4 py-2 text-sm">
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {step === "preview" && preview && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="border border-neutral-200 rounded p-3">
              <div className="text-neutral-500 text-xs">Rows</div>
              <div className="text-lg font-semibold">{preview.totalRows}</div>
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
                These names didn&apos;t match anyone - create as new, or pick who they renamed from (this upload only
                runs for commanders already tracked weekly, so a &quot;new&quot; name here is usually a typo, not
                genuinely new):
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

          <div>
            <p className="text-sm font-medium mb-1">Sample of mapped rows</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-neutral-300 text-left">
                    <th className="py-1 pr-3">Member</th>
                    {Object.values(itemColumns).map((key) => (
                      <th key={key} className="py-1 pr-3">
                        {items.find((i) => i.key === key)?.name ?? key}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleRows.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100">
                      <td className="py-1 pr-3 whitespace-nowrap">{r.memberName}</td>
                      {Object.values(itemColumns).map((key) => (
                        <td key={key} className="py-1 pr-3">
                          {r.values[key] !== undefined ? r.values[key].toLocaleString() : "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleCommit}
              disabled={committing}
              className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm disabled:opacity-50"
            >
              {committing ? "Importing…" : `Commit upload (${preview.totalRows} rows)`}
            </button>
            <button onClick={() => setStep("map")} className="border border-neutral-300 rounded px-4 py-2 text-sm">
              Back to mapping
            </button>
          </div>
        </div>
      )}

      {step === "done" && commitResult && (
        <div className="flex flex-col gap-3">
          <p className="text-green-700 text-sm font-medium">Upload complete.</p>
          <ul className="text-sm text-neutral-700 list-disc pl-5 flex flex-col gap-1">
            <li>{commitResult.rowsProcessed} rows processed</li>
            <li>{commitResult.valuesWritten} value(s) written</li>
            {commitResult.newMembersCreated.length > 0 && <li>New members created: {commitResult.newMembersCreated.join(", ")}</li>}
          </ul>
          <div className="flex gap-2">
            <button onClick={startOver} className="bg-accent text-accent-contrast rounded px-4 py-2 text-sm self-start">
              Upload another file
            </button>
            <Link href={`/setup/seasons/${seasonId}`} className="border border-neutral-300 rounded px-4 py-2 text-sm self-start">
              Back to season
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
