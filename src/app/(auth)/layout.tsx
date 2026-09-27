export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-xl font-semibold tracking-tight">FormCraft</span>
        </div>
        {children}
      </div>
    </div>
  );
}
