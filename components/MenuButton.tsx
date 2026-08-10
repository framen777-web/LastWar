import Link from "next/link";

export function MenuButton({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="block w-full border border-neutral-200 bg-white rounded-lg px-5 py-4 text-left hover:border-neutral-400 active:bg-neutral-50 transition-colors"
    >
      <div className="font-medium text-base">{label}</div>
      {description && <div className="text-neutral-500 text-sm mt-0.5">{description}</div>}
    </Link>
  );
}
