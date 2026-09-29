import Link from "next/link";
import { InvitationAcceptance } from "@/components/forms/invitation-acceptance";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PendingInvitationsPage() {
  const { supabase, user } = await requireUser();
  const { data, error } = await supabase.from("organization_members").select("organization_id, role, invited_at, organizations(name)").eq("user_id", user.id).eq("status", "invited").order("invited_at", { ascending: false });
  if (error) throw new Error("Pending invitations could not be loaded.");
  return <main className="mx-auto max-w-3xl space-y-6 px-6 py-12"><Link href="/dashboard" className="text-sm text-slate-400">← Back to workspace</Link><div><p className="text-sm text-violet-300">Team access</p><h1 className="mt-2 text-3xl font-semibold">Pending invitations</h1></div>{data?.length ? data.map((invite) => { const org = Array.isArray(invite.organizations) ? invite.organizations[0] : invite.organizations; return <section key={invite.organization_id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-900/50 p-5"><div><h2 className="font-semibold">{org?.name ?? "Workspace invitation"}</h2><p className="mt-1 text-sm capitalize text-slate-400">Invited as {invite.role}{invite.invited_at ? ` · ${new Date(invite.invited_at).toLocaleDateString()}` : ""}</p></div><InvitationAcceptance organizationId={invite.organization_id} /></section>; }) : <p className="rounded-xl border border-dashed border-white/15 p-8 text-sm text-slate-400">There are no invitations for {user.email}.</p>}</main>;
}
