"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";

type PendingSelection = { id: number; name: string; role: "keep" | "drop" };

type MergeContextValue = {
  pending: PendingSelection | null;
  choose: (id: number, name: string, role: "keep" | "drop") => void;
  merging: boolean;
};

const MergeContext = createContext<MergeContextValue | null>(null);

/**
 * Wraps the whole table so a "keep" pick on one row and a "drop" pick on a different row can
 * be combined into one merge - DataTable has no idea two of its cells are related, so this
 * context is what connects them instead of lifting state into the page itself. Only one side
 * is ever held in `pending`; the moment a second, different-role, different-member choice
 * comes in, the merge fires immediately (same confirm() wording MergeClient.tsx already uses
 * for the real Merge page) via the same POST /api/users/merge endpoint - no new merge logic,
 * this is purely a second, inline entry point into it.
 */
export function MergeSelectionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choose = useCallback(
    (id: number, name: string, role: "keep" | "drop") => {
      setError(null);

      if (!pending) {
        setPending({ id, name, role });
        return;
      }
      if (pending.id === id) {
        // Same member clicked again - same role cancels the pending pick, a different role
        // just switches which side they're on (still waiting for a second, different member).
        setPending(pending.role === role ? null : { id, name, role });
        return;
      }
      if (pending.role === role) {
        // Two "keep"s or two "drop"s in a row - the newer pick replaces the older one.
        setPending({ id, name, role });
        return;
      }

      // A valid pair: one keep, one drop, two different members.
      const keep = role === "keep" ? { id, name } : { id: pending.id, name: pending.name };
      const drop = role === "drop" ? { id, name } : { id: pending.id, name: pending.name };
      const proceed = confirm(
        `Merge "${drop.name}" into "${keep.name}"? All of "${drop.name}"'s records move onto "${keep.name}", and "${drop.name}" is deleted. This can't be undone.`
      );
      setPending(null);
      if (!proceed) return;

      setMerging(true);
      fetch("/api/users/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId: keep.id, mergeId: drop.id }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(data.error ?? "Merge failed.");
            return;
          }
          if (data.mergedOwnName) {
            // Mirrors MergeClient.tsx - the admin merged away their own logged-in member row,
            // so their session cookie was already re-pointed server-side. A full reload (not
            // router.refresh()) is needed to pick that up everywhere (NavHeader, this page's
            // own access check, etc).
            window.location.reload();
            return;
          }
          router.refresh();
        })
        .finally(() => setMerging(false));
    },
    [pending, router]
  );

  return (
    <MergeContext.Provider value={{ pending, choose, merging }}>
      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded px-3 py-2">
          {error}{" "}
          <button onClick={() => setError(null)} className="underline">
            Dismiss
          </button>
        </div>
      )}
      {pending && (
        <div className="border border-neutral-200 bg-neutral-50 text-neutral-600 text-xs rounded px-3 py-1.5">
          {pending.role === "keep" ? "Keeping" : "Merging away"} <strong>{pending.name}</strong> - click another
          member&apos;s name and choose the opposite to merge them together, or click{" "}
          <strong>{pending.name}</strong> again to cancel.
        </div>
      )}
      {children}
    </MergeContext.Provider>
  );
}

/** Replaces a plain member-name cell for ADMIN - see the call site in app/dashboard/page.tsx. */
export function MergeableMemberName({ memberId, memberName }: { memberId: number; memberName: string }) {
  const ctx = useContext(MergeContext);
  // Viewport coordinates of the popup, or null when closed.
  const [popupPos, setPopupPos] = useState<{ left: number; top: number } | null>(null);

  // The popup is fixed-positioned from a one-off measurement, so it would drift away from
  // the name if anything scrolled underneath it - close it instead (capture phase, so the
  // table's own scroll box counts too, not just the page).
  useEffect(() => {
    if (!popupPos) return;
    const close = () => setPopupPos(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [popupPos]);

  if (!ctx) return <span className="font-medium">{memberName}</span>;

  const isPending = ctx.pending?.id === memberId;

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    if (popupPos) {
      setPopupPos(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    // Flip above the name when there isn't room for the ~80px menu below it.
    const top = rect.bottom + 84 > window.innerHeight ? rect.top - 84 : rect.bottom + 4;
    setPopupPos({ left: rect.left, top });
  }

  return (
    <>
      <button
        onClick={toggle}
        disabled={ctx.merging}
        className={`font-medium text-left hover:underline disabled:opacity-50 ${
          isPending ? (ctx.pending?.role === "keep" ? "text-green-700" : "text-red-700") : "text-neutral-900"
        }`}
      >
        {memberName}
        {isPending && (ctx.pending?.role === "keep" ? " (keep)" : " (drop)")}
      </button>

      {/* Portaled to <body> rather than rendered in place: this name sits in DataTable's
          sticky Member column, where every cell is its own z-10 stacking context with an
          opaque background - rendered in place, the next rows' name cells painted over the
          popup's buttons (invisible on themes where the popup and cells share a colour),
          and the table's overflow-auto box would also clip it near the bottom edge. */}
      {popupPos &&
        createPortal(
          <>
            {/* Invisible click-catcher, closes the popup on an outside click without acting. */}
            <div className="fixed inset-0 z-40" onClick={() => setPopupPos(null)} />
            <div
              style={{ left: popupPos.left, top: popupPos.top }}
              className="fixed z-50 bg-surface-raised text-neutral-900 border border-neutral-200 rounded shadow-lg py-1 flex flex-col min-w-[170px]"
            >
              <button
                onClick={() => {
                  ctx.choose(memberId, memberName, "keep");
                  setPopupPos(null);
                }}
                className="text-left px-3 py-1.5 text-sm text-neutral-900 hover:bg-neutral-100"
              >
                Keep this one
              </button>
              <button
                onClick={() => {
                  ctx.choose(memberId, memberName, "drop");
                  setPopupPos(null);
                }}
                className="text-left px-3 py-1.5 text-sm text-red-600 hover:bg-red-50"
              >
                Merge away (drop)
              </button>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
