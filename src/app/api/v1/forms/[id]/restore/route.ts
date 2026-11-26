import type { NextRequest } from "next/server";
import { archiveViaApi } from "../../archive-shared";

/** Restores an archived form, unpublished, with its slug and responses. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return archiveViaApi(request, (await params).id, false);
}
