import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminSurfaceEnabled } from "@/lib/admin/surface";

export const metadata: Metadata = {
  title: { default: "FormCraft staff", template: "%s · FormCraft staff" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/** The Super Admin portal: a 404 unless ADMIN_SURFACE serves it (surface.ts). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!adminSurfaceEnabled()) notFound();
  return <div className="bg-background min-h-dvh">{children}</div>;
}
