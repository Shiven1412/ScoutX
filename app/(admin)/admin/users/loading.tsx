export default function AdminUsersLoading() {
  return <div aria-busy="true" className="animate-pulse space-y-5">
    <div className="h-3 w-40 rounded bg-white/10" />
    <div className="h-9 w-56 rounded bg-white/10" />
    <div className="h-4 w-72 rounded bg-white/10" />
    <div className="mt-6 h-10 w-80 rounded-lg bg-white/10" />
    <div className="space-y-px overflow-hidden rounded-xl border border-white/10">
      {Array.from({ length: 7 }, (_, index) => <div key={index} className="h-16 bg-slate-900/60" />)}
    </div>
  </div>;
}