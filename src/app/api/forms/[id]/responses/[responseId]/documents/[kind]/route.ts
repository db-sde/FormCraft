import { NextResponse } from "next/server";
import { getCurrentWorkspace } from "@/lib/auth/current-workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { hasPermission } from "@/domains/workspaces/permissions";
import { responseInForm } from "@/domains/responses/records";
import { loadResponseContext } from "@/domains/responses/context";
import {
  documentApplies,
  documentContent,
  documentFilename,
  issueNumber,
  listFormDocuments,
} from "@/domains/documents/issue";
import { renderDocumentPdf } from "@/domains/documents/pdf";
import { DOCUMENT_KINDS, type DocumentKind } from "@/domains/documents/settings";

/**
 * A response's document as a PDF (master spec F-07), for members who may
 * see responses. Built on demand from the saved response — nothing is
 * stored. A configured document keeps its number (issued now if it
 * wasn't yet); a response summary is always available, numbered by the
 * response when the form hasn't set one up. A certificate or order
 * confirmation the response doesn't qualify for is a 404.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; responseId: string; kind: string }> },
) {
  const { id: formId, responseId, kind } = await params;
  if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }
  const { supabase, workspace } = await getCurrentWorkspace();
  if (
    !(await hasPermission(supabase, workspace.id, "view_responses")) ||
    !(await responseInForm(supabase, workspace.id, formId, responseId))
  ) {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  const admin = createAdminClient();
  const ctx = await loadResponseContext(admin, responseId);
  if (!ctx || ctx.status !== "completed") {
    return NextResponse.json(
      {
        error: {
          code: "not_completed",
          message: "Documents are made for submitted responses.",
        },
      },
      { status: 404 },
    );
  }
  const configured = (await listFormDocuments(admin, formId)).find(
    (d) => d.kind === kind,
  );
  let content;
  if (configured) {
    if (!documentApplies(configured.kind, configured.settings, ctx)) {
      return NextResponse.json({ error: { code: "not_eligible" } }, { status: 404 });
    }
    const issued = await issueNumber(admin, configured.id, responseId);
    content = await documentContent(admin, ctx, configured, issued);
  } else if (kind === "summary") {
    content = {
      ...(await documentContent(
        admin,
        ctx,
        { kind: "summary" as DocumentKind, settings: {} },
        { number: 1, issuedAt: ctx.completedAt ?? new Date().toISOString() },
      )),
      numberLabel: `R-${responseId.slice(0, 8).toUpperCase()}`,
    };
  } else {
    return NextResponse.json({ error: { code: "not_found" } }, { status: 404 });
  }

  const pdf = await renderDocumentPdf(content);
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${documentFilename(content.kind, content.numberLabel)}"`,
      "cache-control": "private, no-store",
    },
  });
}
