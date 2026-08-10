"use client";

import { useState } from "react";

const PRESETS = [50, 60, 70, 75, 80, 90, 100];

export function ZoomWrapper({ children, contentId }: { children: React.ReactNode; contentId?: string }) {
  const [zoom, setZoom] = useState(100);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="view-zoom" className="font-medium">
          View %
        </label>
        <select
          id="view-zoom"
          value={PRESETS.includes(zoom) ? zoom : ""}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="border border-neutral-300 rounded px-2 py-1"
        >
          <option value="" disabled>
            Custom
          </option>
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {p}%
            </option>
          ))}
        </select>
        <input
          type="number"
          min={10}
          max={200}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value) || 100)}
          className="border border-neutral-300 rounded px-2 py-1 w-20"
        />
      </div>
      {/* CSS zoom (not transform: scale) so the layout actually reflows smaller -
          no leftover blank space the way scale() would leave. */}
      <div id={contentId} style={{ zoom: `${zoom}%` }}>
        {children}
      </div>
    </div>
  );
}
