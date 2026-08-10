import { prisma } from "@/lib/db";

export async function getWhatsappShareUrl(text: string): Promise<string | null> {
  const setting = await prisma.setting.findUnique({ where: { key: "whatsappNumber" } });
  const number = setting?.value?.trim();
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
