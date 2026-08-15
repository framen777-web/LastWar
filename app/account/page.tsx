import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth/dal";
import { AccountClient } from "./AccountClient";

export default async function AccountPage() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);
  const contact = await prisma.member.findUnique({
    where: { id: user.id },
    select: { contactWhatsapp: true, contactEmail: true },
  });

  return (
    <AccountClient
      name={user.name}
      role={user.role}
      initialTheme={user.theme}
      initialWhatsapp={contact?.contactWhatsapp ?? ""}
      initialEmail={contact?.contactEmail ?? ""}
    />
  );
}
