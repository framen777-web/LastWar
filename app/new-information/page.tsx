import { prisma } from "@/lib/db";
import { MenuButton } from "@/components/MenuButton";
import { requireRole } from "@/lib/auth/dal";

export default async function NewInformationPage() {
  const user = await requireRole(["ADMIN", "LEADER"]);
  const pendingCount = user.role === "ADMIN" ? await prisma.rawExtraction.count({ where: { status: "pending_confirmation" } }) : 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Uploads</h1>
      <div className="flex flex-col gap-3 max-w-sm">
        {user.role === "ADMIN" && <MenuButton href="/upload" label="Image uploads" description="Upload screenshots" />}
        <MenuButton href="/dashboard" label="Upload review" description="Member stats for a given week" />
        <MenuButton
          href="/dashboard/multi"
          label="Multi Event review"
          description="Per-import breakdown for categories that run more than once a week"
        />
        {user.role === "ADMIN" && (
          <MenuButton
            href="/review"
            label="Flagged errors"
            description={
              pendingCount > 0 ? `${pendingCount} waiting for confirmation` : "Confirm free-text imports (e.g. Squads)"
            }
          />
        )}
      </div>
    </div>
  );
}
