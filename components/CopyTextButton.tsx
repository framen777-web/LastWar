"use client";

import { useState } from "react";

export function CopyTextButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 bg-accent text-accent-contrast rounded px-3 py-1.5 text-sm self-start"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
