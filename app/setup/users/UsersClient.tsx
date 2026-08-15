"use client";

import { useEffect, useState } from "react";

type Role = "ADMIN" | "LEADER" | "MEMBER";

type User = {
  id: number;
  name: string;
  allianceRank: string | null;
  roleOverride: Role | null;
  effectiveRole: Role;
  hasPassword: boolean;
  isActive: boolean;
};

export function UsersClient() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [passwordDrafts, setPasswordDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [minPasswordLength, setMinPasswordLength] = useState(8);
  const [lastCompletedWeek, setLastCompletedWeek] = useState<number | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/users");
    const data = await res.json();
    setUsers(data.users ?? []);
    setLastCompletedWeek(data.lastCompletedWeek ?? null);
    setLoading(false);
  }

  useEffect(() => {
    load();
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const n = Number(data.settings?.minPasswordLength);
        if (Number.isInteger(n) && n > 0) setMinPasswordLength(n);
      })
      .catch(() => {});
  }, []);

  async function patchUser(id: number, body: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
    } else {
      await load();
    }
    setBusyId(null);
  }

  const filtered = users.filter((u) => u.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Users</h1>
      <p className="text-neutral-500 text-sm">
        Set a password to grant a member login access. Role is auto-derived from Alliance Rank (R4/R5 → Leader,
        else Member) unless overridden here. Members&apos; Active status is automatic - it reflects whether they had
        stats in the last completed week{lastCompletedWeek !== null ? ` (week ${lastCompletedWeek})` : ""}; Admin and
        Leader accounts stay under your manual control below.
      </p>

      <GeneralPassword minPasswordLength={minPasswordLength} />

      <input
        type="text"
        placeholder="Search by name…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="border border-neutral-300 rounded px-3 py-2 max-w-xs"
      />

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-neutral-300 text-left">
                <th className="py-2 pr-3">Name</th>
                <th className="py-2 pr-3">Rank</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Login</th>
                <th className="py-2 pr-3">Active</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <tr key={u.id} className={`border-b border-neutral-100 ${u.isActive ? "" : "opacity-50"}`}>
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">{u.name}</td>
                  <td className="py-2 pr-3 text-neutral-500">{u.allianceRank ?? "—"}</td>
                  <td className="py-2 pr-3">
                    <select
                      value={u.roleOverride ?? ""}
                      disabled={busyId === u.id}
                      onChange={(e) => patchUser(u.id, { role: e.target.value || null })}
                      className="border border-neutral-300 rounded px-2 py-1"
                    >
                      <option value="">Auto ({u.effectiveRole})</option>
                      <option value="ADMIN">Admin</option>
                      <option value="LEADER">Leader</option>
                      <option value="MEMBER">Member</option>
                    </select>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className={u.hasPassword ? "text-green-700 text-xs" : "text-neutral-400 text-xs"}>
                        {u.hasPassword ? "Has password" : "No access"}
                      </span>
                      <input
                        type="password"
                        placeholder="New password"
                        value={passwordDrafts[u.id] ?? ""}
                        onChange={(e) => setPasswordDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
                        className="border border-neutral-300 rounded px-2 py-1 w-32 text-xs"
                      />
                      <button
                        onClick={async () => {
                          const password = passwordDrafts[u.id] ?? "";
                          if (password.length < minPasswordLength) {
                            setError(`Password must be at least ${minPasswordLength} characters.`);
                            return;
                          }
                          await patchUser(u.id, { password });
                          setPasswordDrafts((d) => ({ ...d, [u.id]: "" }));
                        }}
                        disabled={busyId === u.id || !(passwordDrafts[u.id] ?? "")}
                        className="border border-neutral-300 rounded px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Set
                      </button>
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    {u.effectiveRole === "MEMBER" ? (
                      <span
                        title="Auto-managed from last completed week's stats"
                        className={`text-xs px-2 py-0.5 rounded ${u.isActive ? "bg-green-100 text-green-800" : "bg-neutral-100 text-neutral-500"}`}
                      >
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    ) : (
                      <button
                        onClick={() => patchUser(u.id, { isActive: !u.isActive })}
                        disabled={busyId === u.id}
                        className={`w-9 h-5 rounded-full relative transition-colors ${u.isActive ? "bg-green-500" : "bg-neutral-300"}`}
                        aria-label="Toggle active"
                      >
                        <span
                          className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${u.isActive ? "translate-x-4" : "translate-x-0.5"}`}
                        />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <MergeMembers users={users} onMerged={load} />
    </div>
  );
}

function GeneralPassword({ minPasswordLength }: { minPasswordLength: number }) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => setValue(data.settings?.generalPassword ?? ""))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (value && value.length < minPasswordLength) {
      setError(`Password must be at least ${minPasswordLength} characters.`);
      return;
    }
    setSaving(true);
    await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ generalPassword: value }),
    });
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="border border-neutral-200 rounded max-w-md p-4 flex flex-col gap-2">
      <div className="font-semibold text-sm">General password</div>
      <p className="text-neutral-500 text-xs">
        Used to log in by any member with no password of their own set below. Shown in plain text, not masked, so
        you can read and share it. Never works for Admin accounts - they always need their own password.
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="text"
          value={value}
          disabled={loading}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          placeholder="Not set"
          className="border border-neutral-300 rounded px-2 py-1 text-sm w-48"
        />
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="border border-neutral-300 rounded px-3 py-1 text-sm disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="text-green-700 text-xs">Saved</span>}
      </div>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  );
}

type MergeResult = {
  weeklyStatsMoved: number;
  weeklyStatsDropped: number;
  categoryRecordsMoved: number;
  categoryRecordsDropped: number;
  suggestionsMoved: number;
  suggestionsDropped: number;
  conductorSelectionsMoved: number;
};

function MergeMembers({ users, onMerged }: { users: User[]; onMerged: () => Promise<void> }) {
  const [keepId, setKeepId] = useState<number | "">("");
  const [mergeId, setMergeId] = useState<number | "">("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<MergeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = [...users].sort((a, b) => a.name.localeCompare(b.name));

  async function handleMerge() {
    if (keepId === "" || mergeId === "" || keepId === mergeId) return;
    const keepName = sorted.find((u) => u.id === keepId)?.name;
    const mergeName = sorted.find((u) => u.id === mergeId)?.name;
    if (!confirm(`Merge "${mergeName}" into "${keepName}"? All of "${mergeName}"'s records move onto "${keepName}", and "${mergeName}" is deleted. This can't be undone.`)) {
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/users/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keepId, mergeId }),
    });
    const data = await res.json();
    setRunning(false);
    if (!res.ok) {
      setError(data.error ?? "Merge failed.");
      return;
    }
    setResult(data);
    setKeepId("");
    setMergeId("");
    await onMerged();
  }

  return (
    <div className="border border-neutral-200 rounded max-w-lg p-4 flex flex-col gap-3 mt-2">
      <div className="font-semibold">Merge members</div>
      <p className="text-neutral-500 text-xs">
        For two separate member rows that turned out to be the same person (missed during import). Records move
        onto the kept member; on conflict, the kept member&apos;s existing record wins. The merged-away member is
        deleted.
      </p>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <label className="font-medium">Keep</label>
        <select
          value={keepId}
          onChange={(e) => setKeepId(e.target.value ? Number(e.target.value) : "")}
          className="border border-neutral-300 rounded px-2 py-1"
        >
          <option value="">Select…</option>
          {sorted.map((u) => (
            <option key={u.id} value={u.id} disabled={u.id === mergeId}>
              {u.name}
            </option>
          ))}
        </select>
        <label className="font-medium">Merge away</label>
        <select
          value={mergeId}
          onChange={(e) => setMergeId(e.target.value ? Number(e.target.value) : "")}
          className="border border-neutral-300 rounded px-2 py-1"
        >
          <option value="">Select…</option>
          {sorted.map((u) => (
            <option key={u.id} value={u.id} disabled={u.id === keepId}>
              {u.name}
            </option>
          ))}
        </select>
        <button
          onClick={handleMerge}
          disabled={running || keepId === "" || mergeId === ""}
          className="border border-neutral-300 rounded px-3 py-1 text-sm disabled:opacity-50"
        >
          {running ? "Merging…" : "Merge"}
        </button>
      </div>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {result && (
        <p className="text-green-700 text-sm">
          Merged: {result.weeklyStatsMoved} stat(s) moved ({result.weeklyStatsDropped} dropped on conflict),{" "}
          {result.categoryRecordsMoved} record(s) moved ({result.categoryRecordsDropped} dropped),{" "}
          {result.suggestionsMoved} suggestion(s) moved ({result.suggestionsDropped} dropped),{" "}
          {result.conductorSelectionsMoved} conductor selection(s) moved.
        </p>
      )}
    </div>
  );
}
