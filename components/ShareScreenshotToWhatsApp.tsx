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
//
// Setting fillStyle to a color-function string and reading it back does NOT reliably
// downgrade it to rgb() on current Chrome - the fillStyle getter now preserves whatever
// CSS Color 4 syntax it was given, so a lab()/oklch() input comes back out unchanged.
// Actually rasterizing a pixel and reading its resolved bytes back always yields a
// concrete sRGB value regardless of the input color space, so that's used instead.
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

export function ShareScreenshotToWhatsApp({
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
      // Report panels don't set their own background - on screen they rely on the page
      // body showing through, but html2canvas captures this element in isolation with
      // nothing behind it. A hardcoded white fallback here looks fine on the default theme
      // but breaks every dark theme, where body text is a *light* color meant to sit on a
      // dark page - forcing white behind it produces unreadable near-white-on-white.
      // Resolving the live page background (already theme-correct) instead fixes that for
      // every theme at once, not just this one bug.
      const pageBackground = resolveColor(getComputedStyle(document.body).backgroundColor);

      const canvas = await html2canvas(el, {
        backgroundColor: pageBackground,
        scale: 2,
        onclone: (clonedDoc) => {
          normalizeColors(clonedDoc.body, resolveColor);
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
        alert("Your browser can't share files directly - the image was downloaded instead. Attach it to WhatsApp manually.");
      }
    } finally {
      el.style.zoom = prevZoom;
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handleShare}
      disabled={busy}
      className="inline-flex items-center gap-1.5 bg-green-500 text-white rounded px-3 py-1.5 text-sm hover:bg-green-600 disabled:opacity-50 self-start"
    >
      {busy ? "Preparing image…" : "Share screenshot"}
    </button>
  );
}
