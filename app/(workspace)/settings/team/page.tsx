import { changeMemberRole, removeMember } from "@/actions/settings";
import { ActionButton } from "@/components/forms/action-button";
import { InviteForm } from "@/components/forms/invite-form";
import { requireOrganization } from "@/lib/organization";
import { PLAN_LIMITS } from "@/lib/limits";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function TeamSettingsPage() {
  const { supabase, user, organization, membership } = await requireOrganization();
  const admin = createAdminClient();
  const [{ data: members, error }, { data: subscription }, { count: seatCount, error: seatError }] = await Promise.all([
    supabase.from("organization_members").select("id, user_id, role, status, invited_at, joined_at, users(email, display_name)").eq("organization_id", organization.id).order("created_at", { ascending: true }),
    admin.from("subscriptions").select("plan").eq("organization_id", organization.id).maybeSingle(),
    admin.from("organization_members").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).in("status", ["active", "invited"]),
  ]);
  if (error || seatError) throw new Error("Workspace team could not be loaded.");
  const plan = subscription?.plan ?? "starter";
  const limit = PLAN_LIMITS[plan].seats;
  const used = seatCount ?? 0;
  return <div className="space-y-6"><div><p className="text-sm text-violet-300">Workspace access</p><h1 className="mt-2 text-3xl font-semibold">Team members</h1><p className="mt-2 text-sm text-slate-400">{used} of {limit} seats used on the {plan} plan.</p></div>
    {membership.role !== "member" && <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="mb-4 font-semibold">Invite a teammate</h2><InviteForm /></section>}
    <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold">Members and invitations</h2></div>{members?.length ? <div className="divide-y divide-white/[.07]">{members.map((member) => { const profile = Array.isArray(member.users) ? member.users[0] : member.users; const isSelf = member.user_id === user.id; return <div key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="text-sm font-medium">{profile?.display_name || profile?.email || "Invited account"}{isSelf ? <span className="ml-2 text-xs text-slate-500">(you)</span> : null}</p><p className="mt-1 text-xs text-slate-500">{profile?.email ?? "Invitation pending"} · {member.status === "invited" ? `Invited ${member.invited_at ? new Date(member.invited_at).toLocaleDateString() : ""}` : `Joined ${member.joined_at ? new Date(member.joined_at).toLocaleDateString() : "date unknown"}`}</p></div><div className="flex items-center gap-2"><span className="rounded-full border border-white/10 px-3 py-1 text-xs capitalize">{member.role}</span>{membership.role === "owner" && member.role !== "owner" && <form action={async (data) => { "use server"; await changeMemberRole(data); }} className="flex items-center gap-1"><input type="hidden" name="memberId" value={member.id} /><select name="role" defaultValue={member.role} aria-label={`Role for ${profile?.email ?? member.user_id}`} className="h-8 rounded border border-white/10 bg-slate-950 px-2 text-xs"><option value="admin">Admin</option><option value="member">Member</option></select><button className="h-8 rounded border border-white/10 px-2 text-xs">Save</button></form>}{member.role !== "owner" && membership.role !== "member" && <ActionButton size="sm" variant="ghost" action={removeMember} fields={{ memberId: member.id }}>Remove</ActionButton>}</div></div>; })}</div> : <p className="px-5 py-8 text-sm text-slate-500">No memberships found.</p>}</section>
  </div>;
}
