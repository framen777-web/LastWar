import Link from "next/link";

export function ShareToWhatsApp({ url }: { url: string | null }) {
  if (!url) {
    return (
      <Link href="/settings" className="text-sm text-neutral-500 underline self-start">
        Set a WhatsApp number in Settings to enable sharing
      </Link>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 bg-green-500 text-white rounded px-3 py-1.5 text-sm hover:bg-green-600 self-start"
    >
      Share to WhatsApp
    </a>
  );
}
