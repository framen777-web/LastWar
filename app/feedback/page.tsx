import { requireMenuAccess } from "@/lib/menuAccess";
import { prisma } from "@/lib/db";
import { FeedbackClient } from "./FeedbackClient";

export default async function FeedbackPage() {
  const user = await requireMenuAccess("home-feedback");

  const items = await prisma.feedbackItem.findMany({
    orderBy: { createdAt: "desc" },
    include: { submittedBy: { select: { id: true, name: true } } },
  });

  const canChangeStatus = user.role === "ADMIN" || user.role === "LEADER";

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">Bug Reports & Feature Requests</h1>
      <FeedbackClient
        initialItems={items.map((i) => ({
          id: i.id,
          type: i.type as "bug" | "feature",
          title: i.title,
          description: i.description,
          status: i.status as "open" | "in_progress" | "resolved" | "wont_fix",
          submittedByName: i.submittedBy.name,
          createdAt: i.createdAt.toISOString(),
        }))}
        canChangeStatus={canChangeStatus}
      />
    </div>
  );
}
