import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Radar, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

const capabilities = [
  { icon: Radar, title: "Intent from actual conversations", text: "Bring your organization’s connected sources into one searchable signal workspace." },
  { icon: Sparkles, title: "Context your team can act on", text: "Capture a signal, keep its source context, and turn it into a reviewable outreach draft." },
  { icon: ShieldCheck, title: "Built around your workspace", text: "Organization-scoped records, member roles, and database-enforced access controls." },
];

export default function HomePage() {
  return <main className="min-h-screen overflow-hidden">
    <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
      <Link href="/" className="flex items-center gap-3 text-lg font-bold"><Image src="/logo-mark.svg" width={36} height={36} alt="" aria-hidden="true" />ScoutX</Link>
      <div className="flex items-center gap-3"><Link href="/login" className="px-3 py-2 text-sm text-slate-300 hover:text-white">Sign in</Link><Link href="/register"><Button size="sm">Create account <ArrowRight className="size-4" /></Button></Link></div>
    </nav>
    <section className="mx-auto grid max-w-7xl gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.1fr_.9fr] lg:items-center lg:pt-28">
      <div><p className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-300/20 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-200"><span className="size-1.5 rounded-full bg-violet-300" />Revenue intelligence workspace</p><h1 className="max-w-3xl text-5xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">Turn buyer intent into <span className="text-violet-300">real pipeline.</span></h1><p className="mt-6 max-w-xl text-base leading-7 text-slate-400">ScoutX connects your signals, leads, and outreach in one secure workspace—without invented metrics or demo records.</p><p className="mt-2 text-sm font-medium text-violet-200">Find buyers before your competitors do.</p><div className="mt-8 flex flex-wrap gap-3"><Link href="/register"><Button size="lg">Get started <ArrowRight className="size-4" /></Button></Link><Link href="/login"><Button size="lg" variant="secondary">Sign in to your workspace</Button></Link></div><p className="mt-5 text-xs text-slate-500">Bring your Supabase project and approved source credentials to begin.</p></div>
      <div className="relative rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 p-7 shadow-2xl shadow-violet-950/30 sm:p-10"><div className="absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_at_50%_0%,rgba(139,92,246,.2),transparent_55%)]" /><div className="relative"><div className="flex items-center justify-between border-b border-white/10 pb-5"><div><p className="text-xs uppercase tracking-[.18em] text-slate-500">Workspace overview</p><p className="mt-1 text-sm font-medium">Connected organization data</p></div><ShieldCheck className="size-5 text-emerald-300" /></div><div className="grid grid-cols-2 gap-3 py-6">{["Intent signals", "Outreach drafts", "Qualified leads", "Team activity"].map((item) => <div key={item} className="rounded-xl border border-white/10 bg-white/[.03] p-4"><p className="text-sm font-medium">{item}</p><p className="mt-2 text-xs text-slate-500">Available after setup</p></div>)}</div><div className="rounded-xl border border-dashed border-violet-300/20 bg-violet-400/[.04] p-4 text-sm text-slate-400">Your organization’s stored data appears here after sign-in. No sample metrics are shown.</div></div></div>
    </section>
    <section className="mx-auto grid max-w-7xl gap-4 px-6 pb-24 md:grid-cols-3">{capabilities.map(({ icon: Icon, title, text }) => <article key={title} className="rounded-2xl border border-white/10 bg-white/[.025] p-6"><Icon className="size-5 text-violet-300" /><h2 className="mt-5 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{text}</p></article>)}</section>
  </main>;
}
