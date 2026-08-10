"use client";

import { useState } from "react";
import html2canvas from "html2canvas";

const COLOR_PROPS = [
  "color",
  "backgroundColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
] as const;

// Tailwind v4's palette is authored in oklch(), which html2canvas can't parse
// ("unsupported color function"). The canvas 2D API can resolve *any* valid CSS
// color - including oklch/lab/lch - into a plain rgb() string, so round-tripping
// every element's colors through a scratch canvas normalizes them before capture.
function normalizeColors(root: HTMLElement) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const elements: HTMLElement[] = [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))];
  for (const el of elements) {
    const computed = getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const value = computed[prop];
      if (!value) continue;
      ctx.fillStyle = "#000000";
      ctx.fillStyle = value;
      const normalized = ctx.fillStyle as string;
      (el.style as unknown as Record<string, string>)[prop] = normalized;
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
    try {
      const canvas = await html2canvas(el, {
        backgroundColor: "#ffffff",
        scale: 2,
        onclone: (clonedDoc) => {
          normalizeColors(clonedDoc.body);
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
