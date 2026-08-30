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
  nameConfirmed: boolean;
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

  async function rejectUser(id: number, name: string) {
    const proceed = confirm(
      `Reject "${name}"? This permanently deletes this member and every stat/record attached to their name. This cannot be undone. If this is actually an existing member under a misread or misspelled name, use Merge instead of Reject.`
    );
    if (!proceed) return;

    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/users/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "Something went wrong.");
    else await load();
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
        Leader accounts stay under your manual control below. Members marked <strong>New</strong> were auto-created
        from a screenshot that didn&apos;t match anyone on the roster. If the name is right, click Confirm. If
        it&apos;s really an existing member under a different spelling, use Merge (below) to combine them. If
        it&apos;s outright garbage from a misread screenshot, click Reject to remove it and its stats entirely.
      </p>

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
                  <td className="py-2 pr-3 font-medium whitespace-nowrap">
                    {u.name}
                    {!u.nameConfirmed && (
                      <>
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300">
                          New
                        </span>
                        <button
                          onClick={() => patchUser(u.id, { nameConfirmed: true })}
                          disabled={busyId === u.id}
                          className="ml-2 border border-amber-300 text-amber-800 rounded px-2 py-1 text-xs disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => rejectUser(u.id, u.name)}
                          disabled={busyId === u.id}
                          className="ml-2 border border-red-300 text-red-700 rounded px-2 py-1 text-xs disabled:opacity-50"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </td>
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
    </div>
  );
}
