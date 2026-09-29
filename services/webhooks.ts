import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/secret-box";

export async function deliverWebhookEvent(organizationId: string, eventName: string, data: Record<string, unknown>) {
  const admin = createAdminClient();
  await deliverSlackEvent(admin, organizationId, eventName, data);
  const { data: endpoints, error } = await admin.from("webhooks").select("id, endpoint_url, events, secret_encrypted").eq("organization_id", organizationId).eq("active", true);
  if (error) throw new Error("Webhook endpoints could not be loaded.");
  const matching = (endpoints ?? []).filter((endpoint) => endpoint.events.includes(eventName) && endpoint.secret_encrypted);
  await Promise.allSettled(matching.map(async (endpoint) => {
    const eventId = randomUUID();
    const payload = JSON.stringify({ id: eventId, type: eventName, created_at: new Date().toISOString(), data });
    const secret = decryptSecret(endpoint.secret_encrypted!);
    const signature = createHmac("sha256", secret).update(payload).digest("hex");
    const url = new URL(endpoint.endpoint_url);
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((record) => isPrivateAddress(record.address))) throw new Error("Webhook destination resolved to a private network address.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await fetch(endpoint.endpoint_url, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": "ScoutX-Webhooks/1.0", "x-scoutify-event": eventName, "x-scoutify-delivery": eventId, "x-scoutify-signature": `sha256=${signature}` },
        body: payload,
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      });
      if (response.ok) await admin.from("webhooks").update({ last_delivered_at: new Date().toISOString() }).eq("id", endpoint.id);
    } finally {
      clearTimeout(timeout);
    }
  }));
}

async function deliverSlackEvent(admin: ReturnType<typeof createAdminClient>, organizationId: string, eventName: string, data: Record<string, unknown>) {
  const { data: integration } = await admin.from("integrations").select("id, configuration").eq("organization_id", organizationId).eq("provider", "slack").eq("connected", true).maybeSingle();
  if (!integration) return;
  const configuration = integration.configuration;
  if (typeof configuration !== "object" || configuration === null || Array.isArray(configuration) || typeof configuration.credentials_encrypted !== "string" || typeof configuration.channel_id !== "string") return;
  try {
    const credentials: unknown = JSON.parse(decryptSecret(configuration.credentials_encrypted));
    if (typeof credentials !== "object" || credentials === null || !("access_token" in credentials) || typeof credentials.access_token !== "string") return;
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { authorization: `Bearer ${credentials.access_token}`, "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ channel: configuration.channel_id, text: `ScoutX event: ${eventName}\n${JSON.stringify(data)}` }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const result: unknown = await response.json();
    if (!response.ok || typeof result !== "object" || result === null || !("ok" in result) || result.ok !== true) throw new Error("Slack API did not accept the notification.");
    await admin.from("integrations").update({ last_sync_at: new Date().toISOString(), sync_status: "healthy" }).eq("id", integration.id);
  } catch (error) {
    await admin.from("integrations").update({ sync_status: "error" }).eq("id", integration.id);
    console.error("Slack notification failed", error);
  }
}

function isPrivateAddress(address: string) {
  if (address.includes(":")) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb") || normalized.startsWith("::ffff:127.") || normalized.startsWith("::ffff:10.") || normalized.startsWith("::ffff:192.168.") || normalized.startsWith("::ffff:169.254.");
  }
  const parts = address.split(".").map(Number);
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first >= 224 || (first === 169 && second === 254) || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
