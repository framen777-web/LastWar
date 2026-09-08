"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type BatchValidation =
  | { mode: "rank_single"; maxRank: number; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "rank_multi_team"; teams: { team: string; maxRank: number; memberCount: number }[]; extractedTotal: number; isBalanced: boolean; variance: number }
  | { mode: "per_member"; expectedTotal: number; extractedTotal: number; isBalanced: boolean; variance: number };

type BatchSummary = { categoryKey: string; categoryName: string; weekNumber: number; validation: BatchValidation };

export function VerifyClient() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/verify")
      .then((res) => res.json())
      .then((data) => setBatches(data.batches ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h1 className="text-xl font-semibold">Verify Imports</h1>

      {loading ? (
        <p className="text-neutral-500 text-sm">Loading…</p>
      ) : batches.length === 0 ? (
        <p className="text-neutral-500 text-sm">Nothing waiting for verification.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {batches.map((b) => (
            <li key={`${b.categoryKey}:${b.weekNumber}`}>
              <Link
                href={`/verify/${b.categoryKey}/${b.weekNumber}`}
                className="border border-neutral-200 rounded p-4 flex items-center justify-between gap-3 hover:bg-neutral-50"
              >
                <div>
                  <div className="font-medium">
                    {b.categoryName} — Week {b.weekNumber}
                  </div>
                  <div className="text-neutral-500 text-sm">{b.validation.extractedTotal} members extracted</div>
                </div>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium whitespace-nowrap ${
                    b.validation.isBalanced ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {b.validation.isBalanced ? "✓ Balanced" : `⚠ Variance (${b.validation.variance})`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
