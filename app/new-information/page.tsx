import { prisma } from "@/lib/db";
import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function NewInformationPage() {
  const user = await requireRole(["ADMIN", "LEADER"]);
  const pendingCount = user.role === "ADMIN" ? await prisma.rawExtraction.count({ where: { status: "pending_confirmation" } }) : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">New Information</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        {user.role === "ADMIN" && <MenuButton href="/upload" label="Import" description="Upload screenshots" />}
        <MenuButton href="/dashboard" label="Weekly Info" description="Member stats for a given week" />
        <MenuButton
          href="/dashboard/multi"
          label="Multitable (Multiple Imports)"
          description="Per-import breakdown for categories that run more than once a week"
        />
        {user.role === "ADMIN" && (
          <MenuButton
            href="/review"
            label="Review"
            description={
              pendingCount > 0 ? `${pendingCount} waiting for confirmation` : "Confirm free-text imports (e.g. Squads)"
            }
          />
        )}
      </div>
    </div>
  );
}
