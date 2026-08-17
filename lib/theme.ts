// Preview colors here are literal hex, not CSS vars, so all 6 swatches can render
// simultaneously regardless of the currently-active theme (see AccountClient). These
// necessarily duplicate the values defined in app/globals.css - keep both in sync.
export type ThemeDef = {
  key: string;
  label: string;
  isAccessibilityOption?: boolean;
  preview: { surface: string; raised: string; text: string; accent: string };
};

export const THEMES: ThemeDef[] = [
  {
    key: "default",
    label: "Standard",
    preview: { surface: "#FAFAFA", raised: "#FFFFFF", text: "#171717", accent: "#171717" },
  },
  {
    key: "midnight",
    label: "Midnight",
    preview: { surface: "#0F1621", raised: "#18212F", text: "#E4E9F0", accent: "#4C8DFF" },
  },
  {
    key: "forest",
    label: "Forest",
    preview: { surface: "#131A16", raised: "#1C2620", text: "#DFE7E0", accent: "#5FAF7C" },
  },
  {
    key: "ember",
    label: "Ember",
    preview: { surface: "#FAF6F0", raised: "#FFFFFF", text: "#221C15", accent: "#C2611F" },
  },
  {
    key: "slate",
    label: "Slate",
    preview: { surface: "#F4F6F8", raised: "#FFFFFF", text: "#171C22", accent: "#2B6CB0" },
  },
  {
    key: "high-contrast",
    label: "High Contrast",
    isAccessibilityOption: true,
    preview: { surface: "#000000", raised: "#0A0A0A", text: "#FFFFFF", accent: "#FFD23F" },
  },
  {
    key: "ember-dark",
    label: "Ember Dark",
    preview: { surface: "#1C1611", raised: "#1F1811", text: "#F1E9E2", accent: "#FFB454" },
  },
  {
    key: "vibrant",
    label: "Vibrant Dashboard",
    preview: { surface: "#171B21", raised: "#171B21", text: "#EEF1F4", accent: "#7DD3FC" },
  },
  {
    key: "deep-jewel",
    label: "Deep Jewel",
    preview: { surface: "#151B2C", raised: "#151B2C", text: "#E9EDF6", accent: "#22D3EE" },
  },
  {
    key: "autumn-ember",
    label: "Autumn Ember",
    preview: { surface: "#EFE0C0", raised: "#FFFAF0", text: "#3B2A1C", accent: "#A8340A" },
  },
  {
    key: "harvest",
    label: "Harvest Dashboard",
    preview: { surface: "#EFE0C0", raised: "#FFFAF0", text: "#3B2A1C", accent: "#A1543A" },
  },
  {
    key: "autumn-gradient",
    label: "Autumn Gradient",
    preview: { surface: "#EEDDB8", raised: "#FFF8E9", text: "#3B2A1C", accent: "#A8340A" },
  },
];

export function isValidTheme(key: string): boolean {
  return THEMES.some((t) => t.key === key);
}
