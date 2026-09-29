import { FlagCreateForm, FlagToggle } from "@/components/forms/admin-controls";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/organization";

export default async function FeatureFlagsPage() {
  await requirePlatformAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin.from("feature_flags").select("id, key, description, enabled, updated_at").order("key");
  if (error) throw new Error("Feature flags could not be loaded.");

  return (
    <div>
      <p className="text-sm text-amber-300">Platform administration</p>
      <h2 className="mt-2 text-3xl font-semibold">Feature flags</h2>
      <p className="mt-2 text-sm text-slate-400">Changes are audited and platform administrators only.</p>
      <section className="mt-6 rounded-xl border border-white/10 bg-slate-900/50 p-5">
        <h3 className="mb-4 font-semibold">Create flag</h3>
        <FlagCreateForm />
      </section>
      <section className="mt-5 divide-y divide-white/[.07] rounded-xl border border-white/10 bg-slate-900/50">
        {data?.length ? data.map((flag) => (
          <div key={flag.id} className="flex flex-wrap items-center justify-between gap-3 p-5">
            <div>
              <p className="font-mono text-sm">{flag.key}</p>
              <p className="mt-1 text-sm text-slate-400">{flag.description || "No description"}</p>
              <p className="mt-1 text-xs text-slate-500">Updated {new Date(flag.updated_at).toLocaleString()}</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs capitalize text-slate-400">{flag.enabled ? "Enabled" : "Disabled"}</span>
              <FlagToggle flagKey={flag.key} enabled={flag.enabled} />
            </div>
          </div>
        )) : <p className="p-6 text-sm text-slate-500">No feature flags created.</p>}
      </section>
    </div>
  );
}
