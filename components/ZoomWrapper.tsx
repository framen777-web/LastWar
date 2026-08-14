"use client";

import { useEffect, useRef, useState } from "react";

const MIN_ZOOM = 35;
const MAX_ZOOM = 100;
const BOTTOM_MARGIN = 16;

export function ZoomWrapper({ children, contentId }: { children: React.ReactNode; contentId?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(100);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;

    // Measure at a known 100% baseline rather than dividing the current rendered size by
    // the currently-applied zoom - deriving "natural size" from an already-zoomed
    // measurement compounds any small drift (fonts settling, hydration, a client-side
    // sort changing row count) into a runaway feedback loop, since each pass's error
    // multiplies into the next pass's baseline. Forcing zoom to 100% via the DOM directly,
    // measuring, then setting the real target - all synchronously, before the browser gets
    // a chance to paint the intermediate 100% state - avoids that entirely.
    function recompute() {
      if (!auto) return;
      const prevZoom = inner!.style.zoom;
      inner!.style.zoom = "100%";
      const naturalWidth = inner!.scrollWidth;
      const naturalHeight = inner!.scrollHeight;
      if (naturalWidth <= 0 || naturalHeight <= 0) {
        inner!.style.zoom = prevZoom;
        return;
      }

      const availWidth = outer!.clientWidth;
      const availHeight = window.innerHeight - inner!.getBoundingClientRect().top - BOTTOM_MARGIN;

      const fitWidthPct = (availWidth / naturalWidth) * 100;
      const fitHeightPct = (availHeight / naturalHeight) * 100;
      const next = Math.max(MIN_ZOOM, Math.floor(Math.min(MAX_ZOOM, fitWidthPct, fitHeightPct)));

      inner!.style.zoom = `${next}%`;
      setZoom(next);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(inner);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [auto]);

  return (
    <div ref={outerRef} className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm">
        <label htmlFor="view-zoom" className="font-medium">
          View %
        </label>
        <input
          id="view-zoom"
          type="number"
          min={10}
          max={200}
          value={zoom}
          onChange={(e) => {
            setAuto(false);
            setZoom(Number(e.target.value) || 100);
          }}
          className="border border-neutral-300 rounded px-2 py-1 w-20"
        />
        {!auto && (
          <button type="button" onClick={() => setAuto(true)} className="text-xs text-accent underline decoration-dotted">
            Reset to auto-fit
          </button>
        )}
      </div>
      {/* CSS zoom (not transform: scale) so the layout actually reflows smaller -
          no leftover blank space the way scale() would leave. */}
      <div ref={innerRef} id={contentId} style={{ zoom: `${zoom}%` }}>
        {children}
      </div>
    </div>
  );
}
