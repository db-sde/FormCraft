import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminSurfaceEnabled } from "@/lib/admin/surface";

export const metadata: Metadata = {
  title: { default: "FormCraft staff", template: "%s · FormCraft staff" },
  robots: { index: false, follow: false },
};
export const dynamic = "force-dynamic";

/** The Super Admin portal: only on the admin deployment (ADMIN_SURFACE=1). */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!adminSurfaceEnabled()) notFound();
  return <div className="bg-background min-h-dvh">{children}</div>;
}
