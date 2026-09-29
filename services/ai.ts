import "server-only";

import OpenAI from "openai";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";

const categories = ["pain_point", "seeking_alternative", "feature_request", "buying_intent", "recommendation_request"] as const;
const scoreSchema = z.object({
  category: z.enum(categories),
  confidence: z.number().int().min(0).max(100),
  intent_score: z.number().int().min(0).max(100),
  pain_intensity: z.number().int().min(0).max(100),
  buying_probability: z.number().int().min(0).max(100),
  urgency: z.number().int().min(0).max(100),
  decision_maker_likelihood: z.number().int().min(0).max(100),
  budget_intent: z.number().int().min(0).max(100),
});
const textListSchema = z.object({ items: z.array(z.string().min(1).max(500)).max(20) });
const outreachSchema = z.object({ subject: z.string().max(200), content: z.string().min(1).max(5000) });
const summarySchema = z.object({ summary: z.string().min(1).max(2000) });

const MAX_REQUESTS_PER_MINUTE = 30;
let openAiClient: OpenAI | undefined;

async function generateGeminiJson<T>(organizationId: string, prompt: string, schema: z.ZodType<T>): Promise<{ value: T; model: string }> {
  const apiKey = getServerEnv().GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini is not configured. Add GEMINI_API_KEY to the server environment.");
  await consumeAiRateLimit(organizationId);
  await consumeAiCredit(organizationId);

  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.2, maxOutputTokens: 1200 },
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        if (retryable && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        throw new Error(`Gemini request failed with status ${response.status}.`);
      }
      const result: unknown = await response.json();
      const text = getCandidateText(result);
      const value = schema.parse(JSON.parse(text));
      const { error: statusError } = await createAdminClient().from("provider_status").upsert({
        organization_id: organizationId,
        provider: "gemini",
        connected: true,
        sync_status: "healthy",
        last_sync_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "organization_id,provider" });
      if (statusError) console.error("Gemini provider status could not be recorded", statusError);
      return { value, model: "gemini-2.5-flash" };
    } catch (error) {
      lastError = error;
      if (attempt < 2 && !(error instanceof z.ZodError) && !(error instanceof SyntaxError) && !(error instanceof Error && /status 4\d\d/.test(error.message) && !/status 429/.test(error.message))) {
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }
      break;
    }
  }
  await createAdminClient().from("provider_status").upsert({
    organization_id: organizationId,
    provider: "gemini",
    connected: true,
    sync_status: "error",
    updated_at: new Date().toISOString(),
  }, { onConflict: "organization_id,provider" });
  throw lastError instanceof Error ? lastError : new Error("Gemini generation failed.");
}

function getCandidateText(result: unknown): string {
  if (typeof result !== "object" || result === null) throw new Error("Gemini returned an invalid response.");
  const candidates = (result as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }).candidates;
  const text = candidates?.[0]?.content?.parts?.map((part) => part.text).find((part): part is string => typeof part === "string");
  if (!text) throw new Error("Gemini returned an empty response.");
  return text;
}

export async function scoreIntent(input: { organizationId: string; keyword: string; source: string; context: string }) {
  const { value, model } = await generateGeminiJson(input.organizationId, `Analyze only this public discussion. Do not infer facts that are not stated. Return JSON matching the requested score fields. Keyword: ${input.keyword}\nSource: ${input.source}\nDiscussion: ${input.context}`, scoreSchema);
  return { ...value, model };
}

export async function classifyIntent(input: { organizationId: string; keyword: string; source: string; context: string }) {
  const score = await scoreIntent(input);
  return { category: score.category, confidence: score.confidence, model: score.model };
}

export async function summarizeDiscussion(input: { organizationId: string; context: string }) {
  const result = await generateGeminiJson(input.organizationId, `Summarize this discussion in a concise, factual way. Do not add information. Return JSON with a summary string.\n${input.context}`, summarySchema);
  return { ...result.value, model: result.model };
}

export async function extractPainPoints(input: { organizationId: string; context: string }) {
  const result = await generateGeminiJson(input.organizationId, `Extract only explicitly stated buyer pain points. If none, return an empty items array. Return JSON with an items array of strings.\n${input.context}`, textListSchema);
  return { painPoints: result.value.items, model: result.model };
}

export async function extractBuyerSignals(input: { organizationId: string; context: string }) {
  const result = await generateGeminiJson(input.organizationId, `Extract explicit buying signals only; do not infer budget, authority, or urgency. Return JSON with an items array of concise strings.\n${input.context}`, textListSchema);
  return { signals: result.value.items, model: result.model };
}

export async function generateLeadSummary(input: { organizationId: string; name: string; company: string; source: string; context: string }) {
  const { organizationId, ...details } = input;
  const result = await generateGeminiJson(organizationId, `Write a short factual CRM summary using only the supplied details. Return JSON with a summary string.\n${JSON.stringify(details)}`, summarySchema);
  return { ...result.value, model: result.model };
}

export type OutreachInput = { organizationId: string; prospectName: string | null; company: string | null; source: string; context: string; channel: "email" | "linkedin" };

export async function generateOutreach(input: OutreachInput) {
  const { organizationId, ...details } = input;
  try {
    const result = await generateGeminiJson(organizationId, `Write concise, respectful B2B prospect outreach using only the supplied context. Do not invent product capabilities, quantities, prior relationships, or facts. No unsupported claims. For LinkedIn leave subject empty. Return JSON with subject and content.\n${JSON.stringify(details)}`, outreachSchema);
    return { ...result.value, subject: input.channel === "email" ? result.value.subject : "", model: result.model, provider: "gemini" as const };
  } catch (geminiError) {
    if (geminiError instanceof Error && (geminiError.message.includes("rate limit") || geminiError.message.includes("AI credit limit") || geminiError.message.includes("active subscription"))) throw geminiError;
    if (!getServerEnv().OPENAI_API_KEY) throw geminiError;
    if (!getServerEnv().GEMINI_API_KEY) {
      await consumeAiRateLimit(input.organizationId);
      await consumeAiCredit(input.organizationId);
    }
    const response = await getOpenAiClient().responses.create({
      model: "gpt-4o-mini",
      instructions: "Write accurate, respectful B2B prospect outreach using only the supplied context. Do not invent product capabilities, quantities, prior relationships, or facts. Do not imply private knowledge. Be concise and make no unsupported claims. Return a subject line followed by a blank line and the message. For LinkedIn, omit a subject line.",
      input: JSON.stringify(details),
      max_output_tokens: 500,
    });
    const output = response.output_text.trim();
    if (!output) throw new Error("The configured AI providers returned an empty draft.");
    const [subject, ...body] = output.split("\n");
    const content = body.join("\n").trim();
    if (input.channel === "email" && (!subject || !content)) throw new Error("The AI response did not include an email subject and body.");
    return { subject: input.channel === "email" ? subject.replace(/^subject:\s*/i, "").trim() : "", content: input.channel === "email" ? content : output, model: "gpt-4o-mini", provider: "openai" as const };
  }
}

export async function generateFollowup(input: OutreachInput & { previousMessage: string }) {
  return generateOutreach({ ...input, context: `${input.context}\n\nPrevious outreach (do not repeat verbatim):\n${input.previousMessage}` });
}

export async function generateOutreachDraft(input: OutreachInput) {
  return generateOutreach(input);
}

function getOpenAiClient() {
  const apiKey = getServerEnv().OPENAI_API_KEY;
  if (!apiKey) throw new Error("AI drafting is not configured. Add GEMINI_API_KEY or OPENAI_API_KEY to the server environment.");
  openAiClient ??= new OpenAI({ apiKey });
  return openAiClient;
}

async function consumeAiCredit(organizationId: string) {
  const { error } = await createAdminClient().rpc("consume_ai_credit", { target_org: organizationId, amount: 1 });
  if (error) throw new Error(error.message.includes("quota") ? "This workspace has reached its AI credit limit." : "AI generation requires an active subscription and usage records.");
}

async function consumeAiRateLimit(organizationId: string) {
  const { data: allowed, error } = await createAdminClient().rpc("consume_ai_rate_limit", { target_org: organizationId, max_requests: MAX_REQUESTS_PER_MINUTE });
  if (error || !allowed) throw new Error("AI request rate limit reached. Try again in a minute.");
}