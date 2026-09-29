import Link from "next/link";
import { Building2, KeyRound, PlugZap, Users } from "lucide-react";
import { OrganizationSettingsForm } from "@/components/forms/settings-forms";
import { requireOrganization } from "@/lib/organization";

const links = [
  { href: "/settings/team", title: "Team", description: "Invite people, adjust roles, and manage workspace seats.", icon: Users },
  { href: "/integrations", title: "Integrations", description: "Review provider connections and ingestion options.", icon: PlugZap },
  { href: "/settings/security", title: "Security", description: "Manage API keys, webhooks, and your profile details.", icon: KeyRound },
  { href: "/settings/files", title: "Files", description: "Store private files inside this organization’s storage boundary.", icon: Building2 },
];

export default async function SettingsPage() {
  const { organization, membership } = await requireOrganization();
  return <div className="space-y-7"><div><p className="text-sm text-violet-300">Workspace administration</p><h1 className="mt-2 text-3xl font-semibold">Settings</h1><p className="mt-2 text-sm text-slate-400">Manage this organization’s workspace details and access.</p></div>
    <section className="max-w-2xl rounded-xl border border-white/10 bg-slate-900/50 p-6"><div className="mb-5 flex items-center gap-3"><Building2 className="size-5 text-violet-300" /><div><h2 className="font-semibold">Organization</h2><p className="mt-1 text-xs text-slate-500">Changes apply to all workspace members.</p></div></div>{membership.role === "member" ? <div><p className="font-medium">{organization.name}</p><p className="mt-1 text-sm text-slate-400">{organization.industry || "No industry set"}</p><p className="mt-3 text-xs text-slate-500">Ask an administrator to change organization settings.</p></div> : <OrganizationSettingsForm name={organization.name} industry={organization.industry ?? ""} />}</section>
    <section className="grid gap-3 md:grid-cols-3">{links.map(({ href, title, description, icon: Icon }) => <Link href={href} key={href} className="rounded-xl border border-white/10 bg-slate-900/50 p-5 transition hover:border-violet-400/30"><Icon className="size-5 text-violet-300" /><h2 className="mt-4 font-semibold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-400">{description}</p></Link>)}</section>
  </div>;
}
