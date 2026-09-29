import { createAdminClient } from "@/lib/supabase/admin";
import { hashSecret } from "@/lib/security";
import { z } from "zod";
import { NextResponse, type NextRequest } from "next/server";
import type { Json } from "@/types/database";
import { deliverWebhookEvent } from "@/services/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const signalSchema = z.object({
  platform: z.string().trim().min(1).max(80),
  external_id: z.string().trim().min(1).max(256),
  keyword: z.string().trim().min(1).max(180),
  prospect_name: z.string().trim().max(160).nullable().optional(),
  company: z.string().trim().max(180).nullable().optional(),
  source_url: z.string().url().max(2048).refine((value) => value.startsWith("https://") || value.startsWith("http://"), "Source URL must use HTTP or HTTPS.").nullable().optional(),
  post_snippet: z.string().trim().min(1).max(12000),
  intent_score: z.number().int().min(0).max(100),
  confidence: z.number().int().min(0).max(100),
  category: z.enum(["pain_point", "seeking_alternative", "feature_request", "buying_intent", "recommendation_request"]),
  pain_intensity: z.number().int().min(0).max(100),
  buying_probability: z.number().int().min(0).max(100),
  urgency: z.number().int().min(0).max(100),
  decision_maker_likelihood: z.number().int().min(0).max(100),
  budget_intent: z.number().int().min(0).max(100),
  raw_payload: z.record(z.string(), z.unknown()).optional(),
}).strict();

const batchSchema = z.object({ signals: z.array(signalSchema).min(1).max(100) }).strict();

export async function POST(request: NextRequest) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ((?:scoutx|scoutify)_[A-Za-z0-9_-]{32,})$/.exec(authorization);
  if (!match) return NextResponse.json({ error: "A valid ScoutX API key is required." }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid signal batch.", issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })) }, { status: 422 });

  const admin = createAdminClient();
  const { data: key, error: keyError } = await admin.from("api_keys").select("id, organization_id, scopes, expires_at, revoked_at").eq("key_hash", hashSecret(match[1])).maybeSingle();
  if (keyError || !key || key.revoked_at || (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) || !key.scopes.includes("signals:write")) {
    return NextResponse.json({ error: "The API key is invalid, expired, revoked, or missing the signals:write scope." }, { status: 401 });
  }

  const { data: allowed, error: rateError } = await admin.rpc("consume_api_key_rate_limit", { target_key: key.id, max_requests: 120 });
  if (rateError) return NextResponse.json({ error: "Rate limiting could not be checked." }, { status: 503 });
  if (!allowed) return NextResponse.json({ error: "Rate limit exceeded. Retry in one minute." }, { status: 429, headers: { "Retry-After": "60" } });

  await admin.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", key.id);
  const { data: insertedCount, error: ingestError } = await admin.rpc("ingest_signals", {
    target_org: key.organization_id,
    signal_rows: JSON.parse(JSON.stringify(parsed.data.signals.map((signal) => ({ ...signal, raw_payload: signal.raw_payload ?? {} })))) as Json,
  });
  if (ingestError) {
    const message = ingestError.message.includes("quota") ? "The organization has reached its signal quota." : ingestError.message.includes("Subscription") ? "An active subscription is required to ingest signals." : "Signal batch could not be stored.";
    const status = message.includes("quota") ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
  if (insertedCount > 0) {
    void deliverWebhookEvent(key.organization_id, "signal.batch_ingested", { accepted: insertedCount }).catch((error: unknown) => console.error("Signal webhook delivery failed", error));
  }
  return NextResponse.json({ accepted: insertedCount, received: parsed.data.signals.length, duplicates: parsed.data.signals.length - insertedCount }, { status: 201 });
}
