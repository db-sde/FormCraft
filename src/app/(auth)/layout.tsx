import { CheckCircle2 } from "lucide-react";
import { Brand } from "@/components/app-shell/brand";

const POINTS = [
  "Conversational forms that people actually finish",
  "Lead capture that saves contact details as they're typed",
  "See every response — including the ones that didn't finish",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="bg-canvas flex flex-col px-4 py-8 sm:px-8">
        <Brand />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </div>
      <div className="bg-primary text-primary-foreground relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center lg:px-16">
        <div
          aria-hidden
          className="absolute -top-32 -right-32 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">
          Forms people finish. Leads you never lose.
        </p>
        <ul className="mt-8 space-y-3">
          {POINTS.map((point) => (
            <li key={point} className="flex items-start gap-2.5 text-sm opacity-90">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              {point}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
