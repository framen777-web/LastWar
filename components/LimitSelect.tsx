import { LIMIT_OPTIONS } from "@/lib/reportLayout";

// Plain uncontrolled <select> submitted via the surrounding <form>'s GET, same as the
// Week/Category inputs on these report pages - no client JS needed.
export function LimitSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <>
      <label htmlFor="limit" className="font-medium">
        Show
      </label>
      <select id="limit" name="limit" defaultValue={defaultValue} className="border border-neutral-300 rounded px-2 py-1">
        {LIMIT_OPTIONS.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
        <option value="all">All</option>
      </select>
    </>
  );
}
