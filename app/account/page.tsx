import { requireRole } from "@/lib/auth/dal";
import { AccountClient } from "./AccountClient";

export default async function AccountPage() {
  const user = await requireRole(["ADMIN", "LEADER", "MEMBER"]);
  return <AccountClient name={user.name} role={user.role} initialTheme={user.theme} />;
}
