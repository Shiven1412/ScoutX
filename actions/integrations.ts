"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/organization";
import { readJsonResponse } from "@/lib/http";
import { decryptSecret } from "@/lib/secret-box";
import { encryptSecret } from "@/lib/secret-box";
import { deliverWebhookEvent } from "@/services/webhooks";
import { z } from "zod";
import type { Json } from "@/types/database";
import { getServerEnv } from "@/lib/env";

const slackChannelSchema = z.string().trim().regex(/^[CGD][A-Z0-9]{8,24}$/, "Enter a Slack channel or conversation ID such as C12345678.");

export async function disconnectIntegration(form: FormData) {
  const provider = String(form.get("provider") ?? "");
  if (!["slack", "hubspot", "zapier", "webhook"].includes(provider)) return { error: "Invalid integration." };
  const { supabase, organization } = await requireOrganization(["owner", "admin"]);
  const { data: integration } = await supabase.from("integrations").select("id, configuration").eq("organization_id", organization.id).eq("provider", provider).maybeSingle();
  if (!integration) return { error: "Integration was not found." };
  const config = integration.configuration;
  const safeConfig: Record<string, unknown> = typeof config === "object" && config !== null && !Array.isArray(config) ? { ...config } : {};
  const encrypted = safeConfig.credentials_encrypted;
  delete safeConfig.credentials_encrypted;
  delete safeConfig.channel_id;
  if ((provider === "slack" || provider === "hubspot") && typeof encrypted === "string") {
    try {
      const credentials: unknown = JSON.parse(decryptSecret(encrypted));
      if (typeof credentials === "object" && credentials !== null && "access_token" in credentials && typeof credentials.access_token === "string") {
        if (provider === "slack") {
          await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { authorization: `Bearer ${credentials.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
        } else if ("refresh_token" in credentials && typeof credentials.refresh_token === "string") {
          await fetch(`https://api.hubapi.com/oauth/v1/refresh-tokens/${encodeURIComponent(credentials.refresh_token)}`, { method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(8_000) });
        }
      }
    } catch (error) {
      console.error("Provider token revocation failed", error);
    }
  }
  const { error } = await supabase.from("integrations").update({ connected: false, configuration: JSON.parse(JSON.stringify(safeConfig)) as Json }).eq("id", integration.id).eq("organization_id", organization.id);
  if (error) return { error: "Integration could not be disconnected." };
  revalidatePath("/integrations");
  return { success: true };
}

export async function syncHubSpotLeads() {
  const { supabase, user, organization } = await requireOrganization(["owner", "admin"]);
  const { data: integration, error: integrationError } = await supabase.from("integrations").select("id, configuration").eq("organization_id", organization.id).eq("provider", "hubspot").eq("connected", true).maybeSingle();
  if (integrationError || !integration) return { error: "Connect HubSpot before syncing leads." };
  const config = integration.configuration;
  if (typeof config !== "object" || config === null || Array.isArray(config) || typeof config.credentials_encrypted !== "string") return { error: "HubSpot connection credentials are unavailable. Reconnect the integration." };
  let credentials: { access_token: string; refresh_token?: string; expires_at?: number };
  try {
    const parsed: unknown = JSON.parse(decryptSecret(config.credentials_encrypted));
    if (typeof parsed !== "object" || parsed === null || !("access_token" in parsed) || typeof parsed.access_token !== "string") throw new Error("Invalid token");
    credentials = parsed as { access_token: string; refresh_token?: string; expires_at?: number };
  } catch {
    return { error: "HubSpot credentials could not be decrypted. Check WEBHOOK_ENCRYPTION_KEY and reconnect." };
  }
  if (credentials.expires_at && credentials.expires_at <= Date.now() + 60_000) {
    if (!credentials.refresh_token) return { error: "HubSpot access expired. Reconnect the integration." };
    const env = getServerEnv();
    if (!env.HUBSPOT_CLIENT_ID || !env.HUBSPOT_CLIENT_SECRET) return { error: "HubSpot OAuth credentials are not configured." };
    const body = new URLSearchParams({ grant_type: "refresh_token", client_id: env.HUBSPOT_CLIENT_ID, client_secret: env.HUBSPOT_CLIENT_SECRET, refresh_token: credentials.refresh_token });
    const response = await fetch("https://api.hubapi.com/oauth/v1/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
    let result: unknown;
    try { result = await readJsonResponse(response, "HubSpot"); }
    catch { return { error: "HubSpot credentials expired and refresh failed. Reconnect the integration." }; }
    if (!isObject(result) || typeof result.access_token !== "string" || typeof result.refresh_token !== "string" || typeof result.expires_in !== "number") return { error: "HubSpot credentials expired and refresh failed. Reconnect the integration." };
    credentials = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: Date.now() + result.expires_in * 1000 };
    const { error: tokenSaveError } = await supabase.from("integrations").update({ configuration: JSON.parse(JSON.stringify({ ...config, credentials_encrypted: encryptSecret(JSON.stringify(credentials)) })) as Json }).eq("id", integration.id);
    if (tokenSaveError) return { error: "HubSpot token refreshed but could not be saved securely." };
  }
  const { data: leads, error } = await supabase.from("leads").select("id, name, company, email, title, hubspot_contact_id").eq("organization_id", organization.id).is("deleted_at", null).not("email", "is", null).limit(100);
  if (error) return { error: "Workspace leads could not be loaded." };
  let synced = 0; let failed = 0;
  for (const lead of leads ?? []) {
    if (!lead.email) continue;
    try {
      let hubspotId = lead.hubspot_contact_id;
      const properties = { email: lead.email, firstname: lead.name.split(" ")[0] ?? lead.name, lastname: lead.name.split(" ").slice(1).join(" "), company: lead.company, jobtitle: lead.title ?? "" };
      if (!hubspotId) {
        const search = await fetch("https://api.hubapi.com/crm/v3/objects/contacts/search", { method: "POST", headers: { authorization: `Bearer ${credentials.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: lead.email }] }], properties: ["email"], limit: 1 }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const searchResult: unknown = await readJsonResponse(search, "HubSpot").catch(() => null);
        if (isObject(searchResult) && Array.isArray(searchResult.results)) {
          const match = searchResult.results[0];
          if (isObject(match) && typeof match.id === "string") hubspotId = match.id;
        }
      }
      if (hubspotId) {
        const response = await fetch(`https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(hubspotId)}`, { method: "PATCH", headers: { authorization: `Bearer ${credentials.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ properties }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error("HubSpot contact update failed.");
      } else {
        const response = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", { method: "POST", headers: { authorization: `Bearer ${credentials.access_token}`, "content-type": "application/json" }, body: JSON.stringify({ properties }), cache: "no-store", signal: AbortSignal.timeout(10_000) });
        const result: unknown = await readJsonResponse(response, "HubSpot");
        if (typeof result !== "object" || result === null || !("id" in result) || typeof result.id !== "string") throw new Error("HubSpot contact creation failed.");
        hubspotId = result.id;
        const { error: saveError } = await supabase.from("leads").update({ hubspot_contact_id: hubspotId }).eq("id", lead.id).eq("organization_id", organization.id);
        if (saveError) throw new Error("HubSpot contact created but local mapping could not be stored.");
      }
      if (hubspotId && !lead.hubspot_contact_id) {
        const { error: mappingError } = await supabase.from("leads").update({ hubspot_contact_id: hubspotId }).eq("id", lead.id).eq("organization_id", organization.id);
        if (mappingError) throw new Error("HubSpot contact mapping could not be saved.");
      }
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  await supabase.from("integrations").update({ last_sync_at: new Date().toISOString(), sync_status: failed ? "error" : "healthy" }).eq("organization_id", organization.id).eq("provider", "hubspot");
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "integration.hubspot_synced", entity_type: "integration", metadata: { synced, failed } });
  await deliverWebhookEvent(organization.id, "integration.hubspot_synced", { synced, failed }).catch((error: unknown) => console.error("HubSpot sync webhook delivery failed", error));
  return { success: true, synced, failed };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function saveSlackChannel(form: FormData) {
  const parsed = slackChannelSchema.safeParse(String(form.get("channelId") ?? ""));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid Slack channel ID." };
  const { supabase, organization } = await requireOrganization(["owner", "admin"]);
  const { data: integration, error } = await supabase.from("integrations").select("configuration").eq("organization_id", organization.id).eq("provider", "slack").eq("connected", true).maybeSingle();
  if (error || !integration) return { error: "Connect Slack before setting a notification channel." };
  const configuration = integration.configuration;
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration)) return { error: "Slack settings are invalid. Reconnect Slack." };
  const { error: saveError } = await supabase.from("integrations").update({ configuration: { ...configuration, channel_id: parsed.data } }).eq("organization_id", organization.id).eq("provider", "slack");
  if (saveError) return { error: "Slack notification channel could not be saved." };
  revalidatePath("/integrations");
  return { success: true };
}
