import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth/dal";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB - matches UploadClient's own client-side check

export async function POST(request: Request): Promise<NextResponse> {
  const gate = await requireAdminApi();
  if ("error" in gate) return gate.error;

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ALLOWED_MIME_TYPES,
        maximumSizeInBytes: MAX_FILE_SIZE,
        // Phones commonly reuse filenames (e.g. "1000150435.jpg") across different
        // screenshots, and Blob otherwise refuses to write a pathname that already exists -
        // this is what actually avoids the collision, not anything on the client's upload()
        // call (that version of the SDK doesn't accept addRandomSuffix as a client option).
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
