"use client";

import { useState } from "react";
import { LIMIT_OPTIONS } from "@/lib/reportLayout";
import { STEP_BTN } from "@/components/NumberStepper";

const STOPS: string[] = [...LIMIT_OPTIONS.map(String), "all"];

// A -/+ stepper through the fixed 10/20/50/All stops, visually matching NumberStepper -
// still submits `name="limit"` via the surrounding <form>'s GET the same as the plain
// <select> it replaces, just via a hidden field instead.
export function LimitSelect({ defaultValue }: { defaultValue: string }) {
  const [index, setIndex] = useState(() => Math.max(0, STOPS.indexOf(defaultValue)));
  const value = STOPS[index];

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium">Show</span>
      <div className="inline-flex items-center border border-neutral-300 rounded overflow-hidden">
        <button type="button" aria-label="Fewer rows" disabled={index === 0} onClick={() => setIndex((i) => i - 1)} className={STEP_BTN}>
          −
        </button>
        <span className="border-x border-neutral-300 px-2 py-1.5 text-center w-14">{value === "all" ? "All" : value}</span>
        <button
          type="button"
          aria-label="More rows"
          disabled={index === STOPS.length - 1}
          onClick={() => setIndex((i) => i + 1)}
          className={STEP_BTN}
        >
          +
        </button>
      </div>
      <input type="hidden" name="limit" value={value} />
    </div>
  );
}
