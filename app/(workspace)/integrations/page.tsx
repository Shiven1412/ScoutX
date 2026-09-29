import Link from "next/link";
import { ArrowUpRight, Cable, KeyRound, Webhook } from "lucide-react";
import { requireOrganization } from "@/lib/organization";
import { ProviderConnect } from "@/components/forms/provider-connect";
import { getServerEnv } from "@/lib/env";

const signalProviders = ["reddit", "firecrawl", "serper", "apify", "rss", "hackernews"] as const;
const sourceBackendLabels: Record<string, string> = { reddit: "Reddit API", firecrawl: "Custom websites", serper: "Public web search", apify: "Apify fallback", rss: "RSS feeds", hackernews: "Hacker News" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ connected?: string; error?: string }> }) {
  const params = await searchParams;
  const { supabase, organization, membership } = await requireOrganization();
  const canManage = membership.role !== "member";
  const [{ data: integrations, error }, { count: webhookCount }, { count: activeKeyCount }, { data: subscription }, { data: providerStatuses, error: statusError }] = await Promise.all([
    canManage ? supabase.from("integrations").select("id, provider, connected, sync_status, last_sync_at").eq("organization_id", organization.id).order("provider") : Promise.resolve({ data: [], error: null }),
    supabase.from("webhooks").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).eq("active", true),
    membership.role === "member" ? Promise.resolve({ count: null }) : supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("organization_id", organization.id).is("revoked_at", null),
    canManage ? supabase.from("subscriptions").select("payment_provider").eq("organization_id", organization.id).maybeSingle() : Promise.resolve({ data: null }),
    canManage ? supabase.from("provider_status").select("organization_id, provider, connected, sync_status, last_sync_at").eq("organization_id", organization.id).order("provider") : Promise.resolve({ data: [], error: null }),
  ]);
  if (error || statusError) throw new Error("Integration configuration could not be loaded.");
  const connections = [
    ...(integrations ?? []),
    ...(providerStatuses ?? []).map((item) => ({ ...item, id: `status:${item.provider}` })),
  ];
  const statusByProvider = new Map(connections.map((item) => [item.provider, item]));
  const env = getServerEnv();
  const oauthErrors: Record<string, string> = { oauth_state: "The OAuth state could not be verified. Start the connection again.", oauth_denied: "The provider denied the connection request.", oauth_code: "The provider returned no authorization code.", oauth_config: "Server OAuth credentials are not configured.", oauth_exchange: "The provider token exchange failed. Review provider settings and try again.", oauth_store: "The provider authorized the connection but its credentials could not be stored." };
  const configured: Record<string, boolean> = {
    slack: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
    hubspot: Boolean(env.HUBSPOT_CLIENT_ID && env.HUBSPOT_CLIENT_SECRET),
    gemini: Boolean(env.GEMINI_API_KEY),
    razorpay: Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET),
    reddit: Boolean(env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET && env.REDDIT_USER_AGENT),
    firecrawl: Boolean(env.FIRECRAWL_API_KEY),
    serper: Boolean(env.SERPER_API_KEY),
    apify: Boolean(env.APIFY_TOKEN && env.APIFY_ACTOR_ID),
    rss: true,
    hackernews: true,
  };
  return <div className="space-y-7">
    <div><p className="text-sm text-violet-300">Connected systems</p><h1 className="mt-2 text-3xl font-semibold">Integrations</h1><p className="mt-2 text-sm text-slate-400">Provider configuration and the latest persisted sync outcomes for this workspace.</p></div>
    {params.connected && <p role="status" className="rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-4 text-sm text-emerald-200">{params.connected === "slack" ? "Slack" : params.connected === "hubspot" ? "HubSpot" : "Provider"} connected successfully.</p>}
    {params.error && <p role="alert" className="rounded-lg border border-red-300/20 bg-red-300/10 p-4 text-sm text-red-200">{oauthErrors[params.error] ?? "Integration setup failed."}</p>}
    <section className="rounded-xl border border-violet-300/15 bg-violet-400/[.05] p-6"><div className="flex items-start gap-4"><Cable className="mt-1 size-5 text-violet-300" /><div className="min-w-0 flex-1"><h2 className="font-semibold">ScoutX Signal Ingestion API</h2><p className="mt-2 text-sm leading-6 text-slate-400">Send source records collected and scored by an authorized provider. Requests are validated, organization-scoped by the API key, rate-limited, quota-checked, and persisted in Supabase.</p><code className="mt-4 block overflow-x-auto rounded-lg border border-white/10 bg-slate-950 px-4 py-3 text-xs text-violet-200">POST /api/v1/signals</code><p className="mt-3 text-xs text-slate-500">Required credential: a workspace API key with the signals:write scope. Each request accepts at most 100 signals. Maximum 120 requests per key per minute. Source data is not synthesized when credentials are absent.</p><Link href="/settings/security" className="mt-4 inline-flex items-center text-sm text-violet-300">{membership.role === "member" ? "Contact an admin for API access" : "Manage API keys"}<ArrowUpRight className="ml-1 size-4" /></Link></div></div></section>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-center gap-3"><Webhook className="size-5 text-violet-300" /><div><h2 className="font-semibold">Webhooks</h2><p className="mt-1 text-xs text-slate-500">Persisted outbound registrations</p></div></div><p className="mt-5 text-3xl font-semibold">{webhookCount ?? 0}</p><p className="mt-1 text-xs text-slate-500">{webhookCount ? "Connected" : "Disconnected"} · no provider sync</p><Link href="/settings/security" className="mt-4 inline-flex text-sm text-violet-300">Review webhooks <ArrowUpRight className="ml-1 size-4" /></Link></section>
      <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-center gap-3"><KeyRound className="size-5 text-violet-300" /><div><h2 className="font-semibold">API keys</h2><p className="mt-1 text-xs text-slate-500">Active write-enabled credentials</p></div></div><p className="mt-5 text-3xl font-semibold">{activeKeyCount ?? "Restricted"}</p><p className="mt-1 text-xs text-slate-500">{activeKeyCount ? "Connected" : "Disconnected"} · secret values are never readable after creation</p><Link href="/settings/security" className="mt-4 inline-flex text-sm text-violet-300">Manage credentials <ArrowUpRight className="ml-1 size-4" /></Link></section>
    </div>
    {canManage ? <>
      <section className="grid gap-3 md:grid-cols-2"><ProviderCard provider="slack" configured={configured.slack} record={statusByProvider.get("slack")} /><ProviderCard provider="hubspot" configured={configured.hubspot} record={statusByProvider.get("hubspot")} />
        <StatusCard title="Gemini AI" configured={configured.gemini} record={statusByProvider.get("gemini")} connected={configured.gemini && Boolean(statusByProvider.get("gemini")?.connected)} detail="Gemini is the primary AI provider when its server key is configured." />
        <StatusCard title="Razorpay" configured={configured.razorpay} record={statusByProvider.get("razorpay")} connected={configured.razorpay && Boolean(statusByProvider.get("razorpay")?.connected)} detail={`Workspace billing provider: ${subscription?.payment_provider ?? "not connected"}.`} />
      </section>
      <section><h2 className="mb-3 text-lg font-semibold">Signal collection providers</h2><p className="mb-3 text-xs text-slate-500">Configured credentials are separate from provider health. Status below comes from real collection runs in this workspace.</p><div className="grid gap-3 md:grid-cols-2">{signalProviders.map((provider) => { const record = statusByProvider.get(provider); const stale = Boolean(record?.last_sync_at && Date.now() - new Date(record.last_sync_at).getTime() > 60 * 60 * 1000); return <StatusCard key={provider} title={sourceBackendLabels[provider]} configured={configured[provider]} record={record} connected={configured[provider] && Boolean(record?.connected) && !stale} detail={record?.last_sync_at ? `${stale ? "Last successful run is stale" : "Last persisted collector run"}: ${new Date(record.last_sync_at).toLocaleString()}. Status is workspace-scoped.` : configured[provider] ? "Configured; a matching tracker has not completed a successful run yet." : provider === "rss" ? "Available for selected public feeds; each feed is checked during collection." : "Required credentials are missing from the server environment."} />; })}</div></section>
      <section className="overflow-hidden rounded-xl border border-white/10 bg-slate-900/50"><div className="border-b border-white/10 px-5 py-4"><h2 className="font-semibold">Registered provider connections</h2><p className="mt-1 text-xs text-slate-500">Status and last successful sync come from this organization’s persisted provider records.</p></div>{connections.length ? <div className="divide-y divide-white/[.07]">{connections.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div><p className="text-sm font-medium capitalize">{item.provider}</p><p className="mt-1 text-xs text-slate-500">{item.last_sync_at ? `Last sync ${new Date(item.last_sync_at).toLocaleString()}` : "Last sync: never"}</p></div><StatusLabel connected={item.provider in configured ? configured[item.provider] && item.connected : item.connected} syncStatus={item.sync_status} fallback={item.provider in configured && configured[item.provider] ? "Configured · not run" : "Disconnected"} /></div>)}</div> : <div className="px-5 py-8"><p className="text-sm font-medium">No external provider connections are configured.</p><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Connect Slack or HubSpot, or configure a source provider and activate a matching keyword tracker. Only actual provider records are shown.</p></div>}</section>
    </> : <p className="rounded-xl border border-white/10 bg-slate-900/50 p-5 text-sm text-slate-400">Provider connection details are available to workspace owners and administrators.</p>}
  </div>;
}

type IntegrationRecord = { connected: boolean; sync_status: "healthy" | "syncing" | "error"; last_sync_at: string | null } | undefined;

function ProviderCard({ provider, configured, record }: { provider: "slack" | "hubspot"; configured: boolean; record: IntegrationRecord }) {
  const title = provider === "slack" ? "Slack" : "HubSpot CRM";
  const description = provider === "slack" ? "Authorize ScoutX to post verified workspace events to selected Slack channels." : "Authorize contact read/write access so workspace leads can sync into your portal.";
  return <article className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-white/10 bg-slate-900/50 p-5"><div><h2 className="font-semibold">{title}</h2><p className="mt-1 max-w-md text-xs leading-5 text-slate-400">{description}</p><StatusLabel connected={configured && Boolean(record?.connected)} syncStatus={record?.sync_status} fallback="Disconnected" /><p className="mt-1 text-xs text-slate-500">Last sync: {record?.last_sync_at ? new Date(record.last_sync_at).toLocaleString() : "never"}</p></div><ProviderConnect provider={provider} configured={configured} connected={configured && Boolean(record?.connected)} /></article>;
}

function StatusCard({ title, configured, record, connected, detail }: { title: string; configured: boolean; record: IntegrationRecord; connected: boolean; detail: string }) {
  return <article className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{title}</h2><StatusLabel connected={connected} syncStatus={record?.sync_status} fallback={configured ? "Configured · not run" : "Disconnected"} /></div><p className="mt-2 text-xs leading-5 text-slate-400">{detail}</p><p className="mt-2 text-xs text-slate-500">Credentials: {configured ? "configured on server" : "not configured"}</p><p className="mt-1 text-xs text-slate-500">Last sync: {record?.last_sync_at ? new Date(record.last_sync_at).toLocaleString() : "never"}</p></article>;
}

function StatusLabel({ connected, syncStatus, fallback = "Disconnected" }: { connected: boolean; syncStatus?: "healthy" | "syncing" | "error"; fallback?: string }) {
  const status = syncStatus === "syncing" ? "Syncing" : syncStatus === "error" ? "Error" : connected ? "Connected" : fallback;
  return <p className={`mt-2 text-xs ${status === "Connected" ? "text-emerald-300" : status === "Error" ? "text-red-300" : status === "Syncing" ? "text-amber-300" : "text-slate-500"}`}>{status}</p>;
}