"use client";

import { useEffect, useState } from "react";

type Member = { id: number; name: string; aliases: string[] };

/**
 * Manages Member.aliases (lib/pipeline/matchMemberCore.ts) - the confirmed name variants
 * used to auto-match a garbled/mixed-script OCR reading to the right person, not
 * Member.loginAlias (the single sign-in alias edited on Setup -> Users -> Users). These
 * normally grow on their own (Merge, Rename, or a newly-accepted fuzzy match - see
 * matchMember.ts's recordAliasIfNew) - this page is for inspecting what's accumulated and
 * for adding/removing individual entries by hand.
 */
export function AliasesClient() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/users")
      .then((res) => res.json())
      .then((data) => setMembers(data.users ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function patchAliases(id: number, body: Record<string, unknown>): Promise<boolean> {
    setBusyId(id);
    setError(null);
    const res = await fetch(`/api/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return false;
    }
    return true;
  }

  async function handleAdd(id: number) {
    const alias = (drafts[id] ?? "").trim();
    if (!alias) return;
    const ok = await patchAliases(id, { addAlias: alias });
    if (ok) {
      setMembers((prev) =>
        prev.map((m) => (m.id === id && !m.aliases.some((a) => a.toLowerCase() === alias.toLowerCase()) ? { ...m, aliases: [...m.aliases, alias] } : m))
      );
      setDrafts((d) => ({ ...d, [id]: "" }));
    }
  }

  async function handleRemove(id: number, alias: string) {
    const ok = await patchAliases(id, { removeAlias: alias });
    if (ok) {
      setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, aliases: m.aliases.filter((a) => a !== alias) } : m)));
    }
  }

  const filtered = members.filter(
    (m) => m.name.toLowerCase().includes(filter.toLowerCase()) || m.aliases.some((a) => a.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Aliases</h1>
      <p className="text-neutral-500 text-sm">
        Confirmed name variants a screenshot import can match to each member - these grow automatically from Merge,
        Rename, and newly-accepted fuzzy matches. Add one by hand to pre-teach a known garbled reading, or remove one
        that&apos;s wrong.
      </p>

      <input
        type="text"
        placeholder="Search by name or alias…"
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
                <th className="py-2 pr-3 align-top">Name</th>
                <th className="py-2 pr-3 align-top">Aliases</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => (
                <tr key={m.id} className="border-b border-neutral-100">
                  <td className="py-2 pr-3 font-medium whitespace-nowrap align-top">{m.name}</td>
                  <td className="py-2 pr-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {m.aliases.map((alias) => (
                        <span
                          key={alias}
                          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-neutral-100 border border-neutral-200"
                        >
                          {alias}
                          <button
                            onClick={() => handleRemove(m.id, alias)}
                            disabled={busyId === m.id}
                            aria-label={`Remove alias ${alias}`}
                            className="text-neutral-400 hover:text-red-600 disabled:opacity-50"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      <input
                        type="text"
                        placeholder="Add alias…"
                        value={drafts[m.id] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAdd(m.id);
                          }
                        }}
                        className="border border-neutral-300 rounded px-2 py-1 w-32 text-xs"
                      />
                      <button
                        onClick={() => handleAdd(m.id)}
                        disabled={busyId === m.id || !(drafts[m.id] ?? "").trim()}
                        className="border border-neutral-300 rounded px-2 py-1 text-xs disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
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
