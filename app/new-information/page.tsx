import { prisma } from "@/lib/db";
import { MenuButton } from "@/components/MenuButton";
import { getMenuAccessMap, canSeeMenuItem, requireMenuAccess } from "@/lib/menuAccess";

export default async function NewInformationPage() {
  const user = await requireMenuAccess("home-uploads");
  const pendingCount = user.role === "ADMIN" ? await prisma.rawExtraction.count({ where: { status: "pending_confirmation" } }) : 0;
  const access = await getMenuAccessMap();
  const visible = (key: string) => canSeeMenuItem(access, key, user.role);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Uploads</h1>
      <div className="flex flex-col gap-3 max-w-sm mx-auto">
        {visible("uploads-image-uploads") && (
          <MenuButton
            href="/upload"
            label="Image uploads"
            description="Upload screenshots"
            icon="📸"
            accentKey="uploads-image-uploads"
            index={0}
          />
        )}
        {visible("uploads-review") && (
          <MenuButton
            href="/dashboard"
            label="Upload review"
            description="Member stats for a given week"
            icon="📋"
            accentKey="uploads-review"
            index={1}
          />
        )}
        {visible("uploads-multi-event-review") && (
          <MenuButton
            href="/dashboard/multi"
            label="Multi Event review"
            description="Per-import breakdown for categories that run more than once a week"
            icon="🔁"
            accentKey="uploads-multi-event-review"
            index={2}
          />
        )}
        {visible("uploads-flagged-errors") && (
          <MenuButton
            href="/review"
            label="Flagged errors"
            description={pendingCount > 0 ? `${pendingCount} waiting for confirmation` : "Confirm free-text imports (e.g. Squads)"}
            icon="🚩"
            accentKey="uploads-flagged-errors"
            index={3}
          />
        )}
      </div>
    </div>
  );
}
