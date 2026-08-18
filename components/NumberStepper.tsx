"use client";

import { useState } from "react";

/**
 * A number input with large, reliably-tappable +/- buttons instead of a browser's native
 * spinner arrows (which render a few pixels wide and are hard to hit on touch devices).
 * Still a real named form field (participates in the surrounding <form>'s GET submission
 * on "Go" like the plain input it replaces), just seeded from defaultValue and then
 * self-managed - the enclosing report pages are otherwise plain server-rendered forms with
 * no client state of their own.
 */
export function NumberStepper({
  id,
  name,
  defaultValue,
  min,
  max,
  step = 1,
  listId,
  className = "w-14",
}: {
  id: string;
  name: string;
  defaultValue: number;
  min?: number;
  max?: number;
  step?: number;
  listId?: string;
  className?: string;
}) {
  const [value, setValue] = useState(defaultValue);

  function clamp(n: number): number {
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  }

  return (
    <div className="inline-flex items-center border border-neutral-300 rounded overflow-hidden">
      <button
        type="button"
        aria-label={`Decrease ${name}`}
        onClick={() => setValue((v) => clamp(v - step))}
        disabled={min !== undefined && value <= min}
        className="px-3 py-1.5 text-base leading-none font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        −
      </button>
      <input
        id={id}
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={value}
        list={listId}
        onChange={(e) => setValue(clamp(Number(e.target.value) || 0))}
        className={`border-x border-neutral-300 px-1 py-1.5 text-center [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className}`}
      />
      <button
        type="button"
        aria-label={`Increase ${name}`}
        onClick={() => setValue((v) => clamp(v + step))}
        disabled={max !== undefined && value >= max}
        className="px-3 py-1.5 text-base leading-none font-medium text-neutral-600 hover:bg-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        +
      </button>
    </div>
  );
}
