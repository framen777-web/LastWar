"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { STEP_BTN } from "@/components/NumberStepper";

const MIN_ZOOM = 35;
const MAX_ZOOM = 100;
const BOTTOM_MARGIN = 16;
const ZOOM_STEP = 5;

type ZoomState = { zoom: number; auto: boolean; setZoom: (z: number) => void; setAuto: (a: boolean) => void };
const ZoomContext = createContext<ZoomState | null>(null);

/**
 * Optional - wrap a filter row (containing <ZoomControl/>) and a <ZoomWrapper> together in
 * this when you want the "View %" control placed somewhere other than ZoomWrapper's own
 * default spot directly above the content, e.g. inlined into a page's filter row. Without
 * it, ZoomWrapper manages its own zoom state and renders its own control in its usual
 * position - every page not using ZoomProvider keeps working exactly as before.
 */
export function ZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoom, setZoom] = useState(100);
  const [auto, setAuto] = useState(true);
  return <ZoomContext.Provider value={{ zoom, auto, setZoom, setAuto }}>{children}</ZoomContext.Provider>;
}

function ZoomControlMarkup({ zoom, auto, setZoom, setAuto }: ZoomState) {
  function step(delta: number) {
    setAuto(false);
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta)));
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="font-medium">View %</span>
      <div className="inline-flex items-center border border-neutral-300 rounded overflow-hidden">
        <button type="button" aria-label="Decrease view %" disabled={zoom <= MIN_ZOOM} onClick={() => step(-ZOOM_STEP)} className={STEP_BTN}>
          −
        </button>
        <input
          id="view-zoom"
          type="number"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          value={zoom}
          onChange={(e) => {
            setAuto(false);
            setZoom(Number(e.target.value) || 100);
          }}
          className="border-x border-neutral-300 px-1 py-1.5 text-center w-14 [-moz-appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button type="button" aria-label="Increase view %" disabled={zoom >= MAX_ZOOM} onClick={() => step(ZOOM_STEP)} className={STEP_BTN}>
          +
        </button>
      </div>
      {!auto && (
        <button type="button" onClick={() => setAuto(true)} className="text-xs text-accent underline decoration-dotted">
          Reset to auto-fit
        </button>
      )}
    </div>
  );
}

/** Renders the "View %" control on its own, reading/writing the nearest <ZoomProvider>'s
 * state - only useful together with ZoomProvider; renders nothing without one. */
export function ZoomControl() {
  const ctx = useContext(ZoomContext);
  if (!ctx) return null;
  return <ZoomControlMarkup {...ctx} />;
}

export function ZoomWrapper({ children, contentId }: { children: React.ReactNode; contentId?: string }) {
  const ctx = useContext(ZoomContext);
  const [localZoom, setLocalZoom] = useState(100);
  const [localAuto, setLocalAuto] = useState(true);

  // Falls back to its own local state when there's no surrounding ZoomProvider - that's
  // what keeps every existing caller working unmodified.
  const zoom = ctx ? ctx.zoom : localZoom;
  const auto = ctx ? ctx.auto : localAuto;
  const setZoom = ctx ? ctx.setZoom : setLocalZoom;
  const setAuto = ctx ? ctx.setAuto : setLocalAuto;

  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

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
  }, [auto, setZoom]);

  return (
    <div ref={outerRef} className="flex flex-col gap-3">
      {!ctx && <ZoomControlMarkup zoom={zoom} auto={auto} setZoom={setZoom} setAuto={setAuto} />}
      {/* CSS zoom (not transform: scale) so the layout actually reflows smaller -
          no leftover blank space the way scale() would leave. */}
      <div ref={innerRef} id={contentId} style={{ zoom: `${zoom}%` }}>
        {children}
      </div>
    </div>
  );
}
