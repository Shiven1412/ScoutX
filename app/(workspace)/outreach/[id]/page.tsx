import Link from "next/link";
import { notFound } from "next/navigation";
import { approveOutreach, sendApprovedEmail } from "@/actions/outreach";
import { ActionButton } from "@/components/forms/action-button";
import { OutreachForm } from "@/components/forms/outreach-form";
import { requireOrganization } from "@/lib/organization";

export default async function OutreachDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, organization } = await requireOrganization();
  const { data: message, error } = await supabase.from("outreach_messages").select("*").eq("organization_id", organization.id).eq("id", id).is("deleted_at", null).maybeSingle();
  if (error) throw new Error("Outreach message could not be loaded.");
  if (!message) notFound();
  const [leadResult, history] = await Promise.all([
    supabase.from("leads").select("id, name, company, email").eq("organization_id", organization.id).is("deleted_at", null).order("name").limit(500),
    supabase.from("outreach_versions").select("id, version, subject, content, created_at, generation_metadata").eq("organization_id", organization.id).eq("outreach_message_id", message.id).order("version", { ascending: false }).limit(50),
  ]);
  if (leadResult.error || history.error) throw new Error("Message history could not be loaded.");
  return <div className="mx-auto max-w-4xl space-y-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><Link href="/outreach" className="text-sm text-slate-400 hover:text-white">← Back to outreach</Link><h1 className="mt-4 text-3xl font-semibold">{message.subject}</h1><p className="mt-2 text-sm capitalize text-slate-400">{message.channel} · {message.status}</p></div><div className="flex gap-2">{message.status === "draft" && <ActionButton variant="secondary" action={approveOutreach} fields={{ id: message.id }}>Approve draft</ActionButton>}{message.status === "approved" && message.channel === "email" && <ActionButton action={sendApprovedEmail} fields={{ id: message.id }}>Send approved email</ActionButton>}</div></div>
    {message.status === "draft" ? <section className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="mb-5 font-semibold">Edit draft</h2><OutreachForm leads={leadResult.data ?? []} message={message} /></section> : <section className="whitespace-pre-wrap rounded-xl border border-white/10 bg-slate-900/50 p-6 text-sm leading-7 text-slate-300">{message.content}<p className="mt-6 border-t border-white/10 pt-4 text-xs text-slate-500">{message.approved_at ? `Approved ${new Date(message.approved_at).toLocaleString()}` : ""}{message.sent_at ? ` · Sent ${new Date(message.sent_at).toLocaleString()}` : ""}</p></section>}
    <section className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="font-semibold">Version history</h2>{history.data?.length ? <ol className="mt-4 space-y-4">{history.data.map((version) => <li key={version.id} className="rounded-lg border border-white/[.07] p-4"><div className="flex items-center justify-between"><p className="text-sm font-medium">Version {version.version}: {version.subject}</p><time className="text-xs text-slate-500">{new Date(version.created_at).toLocaleString()}</time></div><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-5 text-slate-400">{version.content}</p></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">No version snapshots are available.</p>}</section>
  </div>;
}
