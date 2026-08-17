import Link from "next/link";
import type { CSSProperties } from "react";

export function MenuButton({
  href,
  label,
  description,
  icon,
  accentKey,
  index = 0,
}: {
  href: string;
  label: string;
  description?: string;
  /** Emoji glyph shown in the icon chip. Omit for a plain text-only card (other hub pages). */
  icon?: string;
  /** Stable id (not DOM position) used to look up a per-card accent for themes that define
   * one (e.g. --menu-accent-{accentKey}) - falls back to the theme's shared card accent
   * when the active theme doesn't define a color for this key. */
  accentKey?: string;
  /** 0-based position, used only to alternate icon gradients on themes that define a
   * second one (--color-icon-bg-alt) - odd positions (1, 3, 5...) get the alt gradient. */
  index?: number;
}) {
  const isAlt = index % 2 === 1;
  const iconFallback = isAlt ? "var(--color-icon-bg-alt, var(--color-icon-bg))" : "var(--color-icon-bg)";
  const iconBackground = accentKey ? `var(--menu-accent-${accentKey}-bg, ${iconFallback})` : iconFallback;

  const cardStyle = {
    "--card-accent": accentKey ? `var(--menu-accent-${accentKey}, var(--color-card-hover-border))` : "var(--color-card-hover-border)",
  } as CSSProperties;

  return (
    <Link
      href={href}
      style={cardStyle}
      className="menu-card flex items-center gap-3 w-full border rounded-lg px-5 py-4 text-left"
    >
      {icon && (
        <span
          className="menu-card-icon shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xl"
          style={{ background: iconBackground }}
        >
          {icon}
        </span>
      )}
      <span className="min-w-0">
        <span className="block font-medium text-base">{label}</span>
        {description && <span className="block text-neutral-500 text-sm mt-0.5">{description}</span>}
      </span>
    </Link>
  );
}
