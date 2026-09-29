import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicEnv } from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/organization";
import { runSystemDiagnostics } from "@/services/system-diagnostics";

export default async function SystemHealthPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const [databaseCheck, billingCheck, providerRows, serperJobRows, diagnostics] = await Promise.all([
    admin.from("organizations").select("id", { count: "exact", head: true }),
    admin.from("stripe_events").select("id", { count: "exact", head: true }),
    admin.from("provider_status").select("provider, connected, sync_status, last_sync_at, updated_at").in("provider", ["gemini", "serper"]).order("updated_at", { ascending: false }).limit(1000),
    admin.from("cron_job_runs").select("job_name, status, started_at, completed_at, error_message").eq("job_name", "serper").order("started_at", { ascending: false }).limit(1),
    runSystemDiagnostics(),
  ]);
  const publicEnv = getPublicEnv();

  const latest = new Map<string, { connected: boolean; sync_status: "healthy" | "syncing" | "error"; last_sync_at: string | null; updated_at: string }>();
  for (const row of providerRows.data ?? []) if (!latest.has(row.provider)) latest.set(row.provider, row);
  const geminiLast = latest.get("gemini");
  const serperLast = latest.get("serper");
  const serperJob = serperJobRows.data?.[0];
  const operationalChecks = [
    ["Gemini last workspace operation", geminiLast ? geminiLast.sync_status : "not run", geminiLast ? `${geminiLast.connected ? "Provider configured" : "Provider disconnected"} · last successful operation ${formatDate(geminiLast.last_sync_at)} · status updated ${formatDate(geminiLast.updated_at)}` : "No workspace has run a Gemini operation yet; environment status only confirms a key is present."],
    ["Serper last workspace sync", serperLast ? serperLast.sync_status : "not run", serperLast ? `${serperLast.connected ? "Provider configured" : "Provider disconnected"} · last successful sync ${formatDate(serperLast.last_sync_at)} · status updated ${formatDate(serperLast.updated_at)}` : "No matching tracker has persisted Serper status yet; environment status only confirms a key is present."],
    ["Latest Serper scheduled job", serperJob?.status ?? "not run", serperJob ? `Started ${formatDate(serperJob.started_at)}${serperJob.error_message ? ` · ${serperJob.error_message}` : ""}` : "No Serper scheduled-job run has been recorded."],
  ] as const;
  console.log("[ScoutX provider operations]", [
    { provider: "Gemini", status: geminiLast?.sync_status ?? "not run", lastSuccessfulOperationAt: geminiLast?.last_sync_at ?? null },
    { provider: "Serper", status: serperLast?.sync_status ?? "not run", lastSuccessfulSyncAt: serperLast?.last_sync_at ?? null, latestScheduledJob: serperJob?.status ?? "not run" },
  ]);

  const checks = [
    ["Supabase database", databaseCheck.error ? "error" : "healthy", databaseCheck.error?.message ?? `Reachable · ${databaseCheck.count ?? 0} organization records`],
    ["Stripe event ledger", billingCheck.error ? "error" : "healthy", billingCheck.error?.message ?? `Reachable · ${billingCheck.count ?? 0} recorded events`],
    ["Supabase Auth config", publicEnv.NEXT_PUBLIC_SUPABASE_URL && publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "configured" : "missing", publicEnv.NEXT_PUBLIC_SUPABASE_URL ?? "Missing project URL"],
  ] as const;
  return <div>
    <p className="text-sm text-amber-300">Platform administration</p><h2 className="mt-2 text-3xl font-semibold">System health</h2><p className="mt-2 text-sm text-slate-400">Live credential checks are shown separately from workspace operation history. Secret values are never displayed; checks that could consume provider credits are not run automatically.</p>
    <h3 className="mt-7 text-lg font-semibold">Core services</h3><div className="mt-3 space-y-3">{checks.map(([name, status, detail]) => <HealthCard key={name} name={name} status={status} detail={detail} />)}</div>
    <h3 className="mt-7 text-lg font-semibold">Live provider diagnostics</h3><p className="mt-1 text-xs text-slate-500">Checks run when this admin page loads. Secrets are never displayed. Providers without a safe free health endpoint are identified rather than tested with a potentially billable operation.</p><div className="mt-3 space-y-3">{diagnostics.map((check) => <HealthCard key={check.name} name={check.name} status={check.status} detail={check.detail} />)}</div>
    <h3 className="mt-7 text-lg font-semibold">Last recorded provider operations</h3><p className="mt-1 text-xs text-slate-500">These records are workspace-scoped; no record means the provider has not yet been exercised for a matching workspace.</p><div className="mt-3 space-y-3">{operationalChecks.map(([name, status, detail]) => <HealthCard key={name} name={name} status={status} detail={detail} />)}</div>
  </div>;
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "never";
}

function HealthCard({ name, status, detail }: { name: string; status: string; detail: string }) {
  const tone = status === "healthy" || status === "configured" || status === "completed" ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200" : status === "error" || status === "failed" ? "border-red-300/20 bg-red-300/10 text-red-200" : "border-amber-300/20 bg-amber-300/10 text-amber-200";
  return <article className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-900/50 p-5"><div><h3 className="font-medium">{name}</h3><p className="mt-1 break-words text-sm text-slate-400">{detail}</p></div><span className={`rounded-full border px-3 py-1 text-xs capitalize ${tone}`}>{status}</span></article>;
}