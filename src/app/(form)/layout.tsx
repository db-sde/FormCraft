/** Every page inside a form (Build, Share, Responses, Integrations) —
 * full width, no workspace sidebar; each page renders FormTopBar. */
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-canvas flex min-h-dvh flex-col">{children}</div>;
}
