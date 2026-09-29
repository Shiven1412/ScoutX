export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <main className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-12">
    <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_20%_10%,rgba(99,102,241,.17),transparent_42%),radial-gradient(ellipse_at_85%_90%,rgba(14,165,233,.09),transparent_38%)]" />
    <div className="relative w-full max-w-md rounded-2xl border border-white/10 bg-slate-900/70 p-8 shadow-2xl shadow-black/40 backdrop-blur sm:p-10">{children}</div>
  </main>;
}
