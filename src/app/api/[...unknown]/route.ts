import { NextResponse } from "next/server";

/**
 * Any /api address that doesn't exist: a JSON 404 for every method,
 * instead of the app's HTML "Page not found" with a 200 for POST, DELETE
 * and OPTIONS (QA FC4-15). Real routes are more specific, so they win.
 */
function notFound() {
  return NextResponse.json(
    { error: { code: "not_found", message: "No such API endpoint." } },
    { status: 404 },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
export const HEAD = notFound;
