import type { NextRequest } from "next/server";
import { archiveViaApi } from "../../archive-shared";

/** Archives a form: unpublished, its link gone (HTTP 410), integrations
 * stopped. Body (optional): {"keep_bookings": true}. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return archiveViaApi(request, (await params).id, true);
}
