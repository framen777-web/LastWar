import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAuthApi } from "@/lib/auth/dal";

const VALID_TYPES = ["bug", "feature"];

// Every member can submit and see every item - not scoped to the submitter (unlike PivotView).
// Only ADMIN/LEADER can change status (see PATCH in [id]/route.ts).
export async function GET() {
  const auth = await requireAuthApi();
  if ("error" in auth) return auth.error;

  const items = await prisma.feedbackItem.findMany({
    orderBy: { createdAt: "desc" },
    include: { submittedBy: { select: { id: true, name: true } } },
  });
  return NextResponse.json({ items });
}

export async function POST(request: Request) {
  const auth = await requireAuthApi();
  if ("error" in auth) return auth.error;

  const body = (await request.json()) as { type?: string; title?: string; description?: string };
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: "type must be 'bug' or 'feature'." }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  const item = await prisma.feedbackItem.create({
    data: {
      type: body.type,
      title,
      description: typeof body.description === "string" ? body.description.trim() : "",
      submittedById: auth.user.id,
    },
  });
  return NextResponse.json({ item }, { status: 201 });
}
