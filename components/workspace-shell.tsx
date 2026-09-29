"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { ArrowUpRight, BarChart3, CreditCard, Gauge, KeyRound, LayoutDashboard, LogOut, Radar, Settings2, Target, Users, Workflow } from "lucide-react";
import { signOut } from "@/actions/auth";
import { cn } from "@/lib/utils";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/intents", label: "Intent signals", icon: Radar },
  { href: "/outreach", label: "Outreach", icon: Workflow },
  { href: "/campaigns", label: "Trackers", icon: Target },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

export function WorkspaceShell({ children, organizationName, role, isPlatformAdmin }: { children: React.ReactNode; organizationName: string; role: string; isPlatformAdmin: boolean }) {
  const pathname = usePathname();
  return <div className="min-h-screen lg:grid lg:grid-cols-[250px_minmax(0,1fr)]">
    <aside className="flex flex-col border-b border-white/10 bg-slate-950/80 px-4 py-4 lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r lg:px-3 lg:py-6">
      <Link href="/dashboard" className="flex items-center gap-3 px-2 text-lg font-bold"><Image src="/logo-mark.svg" width={36} height={36} alt="" aria-hidden="true" /><span>ScoutX<span className="mt-0.5 block text-[10px] font-normal text-slate-400">Find buyers before your competitors do.</span></span></Link>
      <div className="mt-7 rounded-xl border border-white/10 bg-white/[.035] p-3"><p className="truncate text-sm font-semibold">{organizationName}</p><p className="mt-1 text-xs capitalize text-slate-500">{role} workspace</p></div>
      <nav aria-label="Workspace" className="mt-6 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">{navigation.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors", active ? "bg-violet-500/15 text-violet-200" : "text-slate-400 hover:bg-white/[.05] hover:text-white")}><Icon className="size-4" />{label}</Link>;
      })}</nav>
      <div className="mt-6 border-t border-white/10 pt-4 lg:mt-auto">
        <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-1">
          <Link href="/integrations" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.05] hover:text-white"><Gauge className="size-4" />Integrations</Link>
          <Link href="/billing" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.05] hover:text-white"><CreditCard className="size-4" />Billing</Link>
          <Link href="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.05] hover:text-white"><Settings2 className="size-4" />Settings</Link>
          <Link href="/settings/files" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.05] hover:text-white"><KeyRound className="size-4" />Files</Link>
          {isPlatformAdmin && <Link href="/admin" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-white/[.05] hover:text-white"><KeyRound className="size-4" />Platform admin</Link>}
        </div>
        <form action={signOut} className="mt-2"><button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-slate-400 hover:bg-white/[.05] hover:text-white"><LogOut className="size-4" />Sign out<ArrowUpRight className="ml-auto size-3" /></button></form>
      </div>
    </aside>
    <div className="min-w-0"><header className="flex h-16 items-center justify-between border-b border-white/10 px-5 sm:px-8"><div><p className="text-xs text-slate-500">{organizationName}</p><p className="text-sm font-medium">Find buyers before your competitors do.</p></div><span className="rounded-full border border-white/10 px-3 py-1 text-xs capitalize text-slate-400">{role}</span></header><main className="mx-auto max-w-[1500px] p-5 sm:p-8">{children}</main></div>
  </div>;
}
