"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

type Asset = { name: string; created_at: string; metadata: { size?: number; mimetype?: string } | null };

export function AssetManager({ organizationId, initialAssets, canManage }: { organizationId: string; initialAssets: Asset[]; canManage: boolean }) {
  const [assets, setAssets] = useState(initialAssets);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function upload(form: FormData) {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setError("Choose a file to upload."); return; }
    if (file.size > 10 * 1024 * 1024) { setError("Files must be 10 MB or smaller."); return; }
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf", "text/plain"].includes(file.type)) { setError("File type is not allowed."); return; }
    const path = `${organizationId}/${crypto.randomUUID()}/${file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100)}`;
    setError(undefined);
    startTransition(async () => {
      const { error: storageError } = await createClient().storage.from("organization-files").upload(path, file, { contentType: file.type, upsert: false });
      if (storageError) { setError("The file could not be uploaded. Verify workspace permissions and storage setup."); return; }
      setAssets((current) => [{ name: path, created_at: new Date().toISOString(), metadata: { size: file.size, mimetype: file.type } }, ...current]);
    });
  }

  function open(name: string) {
    startTransition(async () => {
      const { data, error: storageError } = await createClient().storage.from("organization-files").createSignedUrl(name, 60);
      if (storageError || !data?.signedUrl) { setError("The file could not be opened."); return; }
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    });
  }

  function remove(name: string) {
    if (!canManage) return;
    setError(undefined);
    startTransition(async () => {
      const { error: storageError } = await createClient().storage.from("organization-files").remove([name]);
      if (storageError) { setError("The file could not be deleted."); return; }
      setAssets((current) => current.filter((item) => item.name !== name));
    });
  }

  return <section className="rounded-xl border border-white/10 bg-slate-900/50 p-5"><h2 className="font-semibold">Organization files</h2><p className="mt-1 text-sm text-slate-400">Private files stored under this organization. Uploads are limited to 10 MB and approved file types.</p>
    {canManage && <form className="mt-5 flex flex-wrap items-center gap-3" action={upload}><input aria-label="Choose file" name="file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" required className="max-w-full text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2" /><Button size="sm" disabled={pending}>{pending ? "Uploading…" : "Upload file"}</Button></form>}
    {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    {assets.length ? <ul className="mt-5 divide-y divide-white/[.07]">{assets.map((asset) => <li key={asset.name} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{asset.name.split("/").at(-1)}</p><p className="mt-1 text-xs text-slate-500">{asset.metadata?.mimetype ?? "Unknown type"} · {asset.metadata?.size ? `${Math.ceil(asset.metadata.size / 1024)} KB` : "Size unavailable"} · {new Date(asset.created_at).toLocaleString()}</p></div><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={pending} onClick={() => open(asset.name)}>Open</Button>{canManage && <Button size="sm" variant="ghost" disabled={pending} onClick={() => remove(asset.name)}>Delete</Button>}</div></li>)}</ul> : <p className="mt-5 text-sm text-slate-500">No files stored in this workspace.</p>}
  </section>;
}
