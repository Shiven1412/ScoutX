"use client";

import { useState, useTransition } from "react";
import { archiveOrganization, createFeatureFlag, deleteOrganizationPermanently, setFeatureFlagEnabled, setPlatformAdmin } from "@/actions/admin";
import { Button } from "@/components/ui/button";
import { FormField, Input } from "@/components/ui/form-field";

type FormAction = (data: FormData) => Promise<{ error?: string; success?: boolean } | void>;
function ErrorLine({ error }: { error?: string }) { return error ? <p role="alert" className="mt-2 text-xs text-red-300">{error}</p> : null; }

export function FlagCreateForm() {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end" action={(data) => startTransition(async () => { const result = await createFeatureFlag(data); setError(result?.error); if (!result?.error) window.location.reload(); })}><FormField label="Key"><Input name="key" placeholder="new_feature.enabled" required maxLength={81} /></FormField><FormField label="Description"><Input name="description" maxLength={500} /></FormField><select name="enabled" className="h-11 rounded-lg border border-white/10 bg-slate-950 px-3 text-sm"><option value="false">Disabled</option><option value="true">Enabled</option></select><Button disabled={pending}>{pending ? "Saving…" : "Add flag"}</Button><ErrorLine error={error} /></form>;
}

export function FlagToggle({ flagKey, enabled }: { flagKey: string; enabled: boolean }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => { const data = new FormData(); data.set("key", flagKey); data.set("enabled", String(!enabled)); const result = await setFeatureFlagEnabled(data); setError(result?.error); if (!result?.error) window.location.reload(); })}>{pending ? "Saving…" : enabled ? "Disable" : "Enable"}</Button><ErrorLine error={error} /></div>;
}

export function PlatformRoleToggle({ userId, enabled, isSelf }: { userId: string; enabled: boolean; isSelf: boolean }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button size="sm" variant="ghost" disabled={pending || (isSelf && enabled)} onClick={() => startTransition(async () => { const data = new FormData(); data.set("userId", userId); data.set("enabled", String(!enabled)); const result = await setPlatformAdmin(data); setError(result?.error); if (!result?.error) window.location.reload(); })}>{enabled ? "Revoke admin" : "Grant admin"}</Button><ErrorLine error={error} /></div>;
}

export function AdminActionButton({ action, fields, label }: { action: FormAction; fields: Record<string, string>; label: string }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button size="sm" variant="danger" disabled={pending} onClick={() => startTransition(async () => { const data = new FormData(); Object.entries(fields).forEach(([key, value]) => data.set(key, value)); const result = await action(data); setError(result?.error); })}>{pending ? "Working…" : label}</Button><ErrorLine error={error} /></div>;
}

export function ArchiveOrganizationButton({ organizationId }: { organizationId: string }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button size="sm" variant="secondary" disabled={pending} onClick={() => startTransition(async () => { const data = new FormData(); data.set("organizationId", organizationId); const result = await archiveOrganization(data); setError(result?.error); if (!result?.error) window.location.reload(); })}>{pending ? "Archiving…" : "Archive"}</Button><ErrorLine error={error} /></div>;
}

export function PermanentlyDeleteOrganization({ organizationId }: { organizationId: string }) {
  const [confirmation, setConfirmation] = useState(""); const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div className="mt-4 border-t border-red-300/15 pt-4"><p className="text-xs leading-5 text-red-200">Permanent deletion irreversibly removes the organization and tenant-owned records. Type the exact organization ID to confirm.</p><input aria-label="Confirm organization ID for permanent deletion" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} className="mt-3 h-9 w-full rounded border border-red-300/20 bg-slate-950 px-3 font-mono text-xs" /><Button className="mt-2" size="sm" variant="danger" disabled={pending || confirmation !== organizationId} onClick={() => startTransition(async () => { setError(undefined); const data = new FormData(); data.set("organizationId", organizationId); data.set("confirmation", confirmation); const result = await deleteOrganizationPermanently(data); if (result?.error) setError(result.error); else window.location.assign("/admin/organizations"); })}>{pending ? "Deleting…" : "Permanently delete organization"}</Button><ErrorLine error={error} /></div>;
}
