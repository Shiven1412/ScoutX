import { revokeApiKey, revokeWebhook } from "@/actions/settings";
import { ActionButton } from "@/components/forms/action-button";
import { ApiKeyForm } from "@/components/forms/api-key-form";
import { ProfileSettingsForm } from "@/components/forms/settings-forms";
import { WebhookForm } from "@/components/forms/webhook-form";
import { requireOrganization } from "@/lib/organization";

export default async function SecuritySettingsPage() {
  const { supabase, user, organization, membership } = await requireOrganization();
  const [{ data: profile, error: profileError }, { data: keys, error: keysError }, { data: webhooks, error: hooksError }] = await Promise.all([
    supabase.from("profiles").select("full_name, company, industry").eq("id", user.id).maybeSingle(),
    membership.role === "member" ? Promise.resolve({ data: [], error: null }) : supabase.from("api_keys").select("id, name, key_prefix, scopes, last_used_at, expires_at, revoked_at, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }),
    membership.role === "member" ? Promise.resolve({ data: [], error: null }) : supabase.from("webhooks").select("id, name, endpoint_url, events, active, last_delivered_at, created_at").eq("organization_id", organization.id).order("created_at", { ascending: false }),
  ]);
  if (profileError || keysError || hooksError) throw new Error("Security settings could not be loaded.");
  const isAdmin = membership.role !== "member";
  return <div className="space-y-7"><div><p className="text-sm text-violet-300">Identity and credentials</p><h1 className="mt-2 text-3xl font-semibold">Security</h1><p className="mt-2 text-sm text-slate-400">Credentials are write-only at creation and are never returned from storage.</p></div>
    <section className="max-w-2xl rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="mb-5 font-semibold">My profile</h2><ProfileSettingsForm fullName={profile?.full_name ?? ""} company={profile?.company ?? ""} industry={profile?.industry ?? ""} /></section>
    {isAdmin && <><section className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="font-semibold">API keys</h2><p className="mt-1 text-sm text-slate-400">Only a SHA-256 hash and short prefix are stored. Copy a key when it is created.</p><div className="mt-5 max-w-xl"><ApiKeyForm /></div>{keys?.length ? <div className="mt-6 divide-y divide-white/[.07]">{keys.map((key) => <div key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{key.name} <code className="ml-2 text-xs text-slate-500">{key.key_prefix}…</code></p><p className="mt-1 text-xs text-slate-500">{key.revoked_at ? `Revoked ${new Date(key.revoked_at).toLocaleDateString()}` : key.expires_at ? `Expires ${new Date(key.expires_at).toLocaleDateString()}` : "No expiration"} · Last used {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "never"}</p></div>{!key.revoked_at && <ActionButton size="sm" variant="ghost" action={revokeApiKey} fields={{ id: key.id }}>Revoke</ActionButton>}</div>)}</div> : <p className="mt-5 text-sm text-slate-500">No API keys stored.</p>}</section>
      <section className="rounded-xl border border-white/10 bg-slate-900/50 p-6"><h2 className="font-semibold">Outbound webhooks</h2><p className="mt-1 text-sm text-slate-400">Signing secrets are encrypted at rest. HTTPS destinations are required.</p><div className="mt-5 max-w-xl"><WebhookForm /></div>{webhooks?.length ? <div className="mt-6 divide-y divide-white/[.07]">{webhooks.map((hook) => <div key={hook.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="text-sm font-medium">{hook.name}</p><p className="mt-1 max-w-lg truncate text-xs text-slate-500">{hook.endpoint_url} · {hook.events.join(", ")} · {hook.active ? "Active" : "Disabled"}</p></div>{hook.active && <ActionButton size="sm" variant="ghost" action={revokeWebhook} fields={{ id: hook.id }}>Disable</ActionButton>}</div>)}</div> : <p className="mt-5 text-sm text-slate-500">No webhook endpoints registered.</p>}</section></>}
    {!isAdmin && <p className="rounded-xl border border-white/10 bg-slate-900/50 p-5 text-sm text-slate-400">API keys and webhook settings are available to workspace admins and owners.</p>}
  </div>;
}
