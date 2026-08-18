"use client";

import { useState } from "react";
import html2canvas from "html2canvas";

// Plain single-color properties, swapped directly - plus shorthands (box-shadow,
// text-shadow) that can *embed* a color function inside a larger value, handled below
// by pattern-matching instead. SVG icons' fill/stroke often resolve `currentColor` to a
// modern color function even on browsers/elements where the equivalent `color` property
// serializes differently, so those need covering separately from `color` itself.
const COLOR_PROPS = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "outlineColor",
  "textDecorationColor",
  "caretColor",
  "columnRuleColor",
  "accentColor",
  "fill",
  "stroke",
] as const;

const SHORTHAND_PROPS = ["boxShadow", "textShadow"] as const;

// Non-global, used only to cheaply test whether a value needs touching at all - a global
// regex's .test() mutates lastIndex across calls, which would silently skip matches.
const HAS_MODERN_COLOR_FN = /\b(?:oklch|lab|lch|color|hwb)\(/;
const MODERN_COLOR_FN_G = /\b(?:oklch|lab|lch|color|hwb)\([^()]*\)/g;

// Tailwind v4's palette is authored in oklch(), which html2canvas can't parse
// ("unsupported color function") - and depending on the property, the browser can
// resolve `currentColor` back out as oklch(), lab(), or other CSS Color 4 functions
// html2canvas equally can't parse. The canvas 2D API can resolve *any* valid CSS color
// into a plain rgb() string, so round-tripping every matched color function through a
// scratch canvas normalizes them before capture.
function createColorResolver(): (colorFn: string) => string {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  return (colorFn: string) => {
    if (!ctx) return colorFn;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = colorFn;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(3)})`;
  };
}

function normalizeColors(root: HTMLElement, resolve: (colorFn: string) => string) {
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of elements) {
    const computed = getComputedStyle(el);
    const style = el.style as unknown as Record<string, string>;

    for (const prop of COLOR_PROPS) {
      const value = computed[prop];
      if (!value || !HAS_MODERN_COLOR_FN.test(value)) continue;
      style[prop] = resolve(value);
    }

    for (const prop of SHORTHAND_PROPS) {
      const value = computed[prop];
      if (!value || !HAS_MODERN_COLOR_FN.test(value)) continue;
      style[prop] = value.replace(MODERN_COLOR_FN_G, resolve);
    }
  }
}

// Shared screenshots should look the same regardless of the sharer's own theme - forces
// plain body/table text to black and any element that already has a background to white,
// after normalizeColors has made every color a plain rgb() html2canvas can parse. Borders
// and accent-colored elements (buttons, panel header bars) are left alone on purpose - only
// text and backgrounds flip, not the whole capture to strict monochrome.
function forceWhiteBlackTheme(root: HTMLElement) {
  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of elements) {
    const computed = getComputedStyle(el);
    el.style.color = "#000000";
    if (computed.backgroundColor !== "rgba(0, 0, 0, 0)" && computed.backgroundColor !== "transparent") {
      el.style.backgroundColor = "#ffffff";
    }
  }
}

/**
 * One generic "Share" button for a report, not tied to any specific platform -
 * navigator.share() with a captured image file already opens the OS's native share sheet,
 * which lists WhatsApp alongside every other installed app that accepts an image, so no
 * platform-specific branching is needed. Falls back to downloading the PNG on
 * browsers/devices without file-sharing support.
 */
export function ShareReportButton({
  targetId,
  filename = "report.png",
  title = "Report",
}: {
  targetId: string;
  filename?: string;
  title?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function handleShare() {
    const el = document.getElementById(targetId);
    if (!el) return;

    setBusy(true);
    // ZoomWrapper's on-screen auto-fit preview uses the non-standard CSS `zoom` property,
    // which html2canvas doesn't account for - it sizes the capture canvas from the zoomed
    // (small) bounding box but paints content at its un-zoomed layout position, so anything
    // zoomed below 100% (routine on a narrow phone, where auto-fit has to shrink a wide
    // report a lot) gets its text painted outside the canvas entirely. Force 100% just for
    // the capture, then restore whatever the on-screen preview had.
    const prevZoom = el.style.zoom;
    el.style.zoom = "100%";
    try {
      const resolveColor = createColorResolver();
      // Shared screenshots always render pure white/black regardless of the sharer's own
      // theme - a dark-themed report shared into a chat should look the same as a
      // light-themed one, not carry the sender's color scheme into what's essentially a
      // printed report.
      const CAPTURE_BACKGROUND = "#ffffff";

      // Without explicit width/height, html2canvas sizes the canvas from
      // el.getBoundingClientRect() - but a wide report's panels (flex-row, flex-nowrap)
      // overflow past their block-level container's own box, which doesn't grow to fit
      // them. That crops everything past the container's edge, worse on a narrow phone
      // where the container itself is much narrower than the report. scrollWidth/Height
      // reflect the true content extent including that overflow, and windowWidth/Height
      // keep html2canvas's simulated viewport wide enough that nothing wraps or clips
      // during the off-screen layout pass either.
      const captureWidth = el.scrollWidth;
      const captureHeight = el.scrollHeight;

      const canvas = await html2canvas(el, {
        backgroundColor: CAPTURE_BACKGROUND,
        scale: 2,
        width: captureWidth,
        height: captureHeight,
        windowWidth: captureWidth,
        windowHeight: captureHeight,
        onclone: (clonedDoc) => {
          normalizeColors(clonedDoc.body, resolveColor);
          forceWhiteBlackTheme(clonedDoc.body);
        },
      });
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;

      const file = new File([blob], filename, { type: "image/png" });

      if (typeof navigator.canShare === "function" && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        alert("Your browser can't share files directly - the image was downloaded instead.");
      }
    } finally {
      el.style.zoom = prevZoom;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={busy}
      className="border border-neutral-300 rounded px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:opacity-50"
    >
      {busy ? "Preparing…" : "Share"}
    </button>
  );
}
