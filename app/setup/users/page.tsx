import { requireAdmin } from "@/lib/auth/dal";
import { UsersClient } from "./UsersClient";

export default async function UsersPage() {
  await requireAdmin();
  return <UsersClient />;
}
