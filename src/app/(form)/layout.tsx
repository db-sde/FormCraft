/** Every page inside a form. The builder is full-screen; Responses,
 * Integrations, Settings and Share add the app frame in (sections). */
export default function FormLayout({ children }: { children: React.ReactNode }) {
  return <div className="bg-background flex min-h-dvh flex-col">{children}</div>;
}
