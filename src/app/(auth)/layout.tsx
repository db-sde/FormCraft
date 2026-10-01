import { Brand } from "@/components/app-shell/brand";

/** The logo above a centred index card on the paper background. On
 * phones the card loses its frame and fills the screen. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card sm:bg-background flex min-h-dvh flex-col px-5 pt-14 pb-6 sm:items-center sm:px-8 sm:py-10">
      <Brand size="sm" className="sm:hidden" />
      <div className="flex w-full flex-1 flex-col sm:max-w-[396px] sm:flex-none sm:items-center sm:gap-6 sm:pt-[6vh]">
        <Brand className="hidden sm:flex" />
        {children}
      </div>
    </div>
  );
}
