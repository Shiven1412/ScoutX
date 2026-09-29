import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getServerEnv } from "@/lib/env";
import { runScheduledJob, type ScheduledJob } from "@/services/signals/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jobs = new Set<ScheduledJob>(["reddit", "serper", "firecrawl", "apify", "reprocess", "analytics"]);

export async function GET(request: NextRequest, context: { params: Promise<{ job: string }> }) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Scheduled jobs are not configured." }, { status: 503 });
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  if (expectedBuffer.length !== suppliedBuffer.length || !timingSafeEqual(expectedBuffer, suppliedBuffer)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { job } = await context.params;
  if (!jobs.has(job as ScheduledJob)) return NextResponse.json({ error: "Unknown scheduled job." }, { status: 404 });
  try {
    const result = await runScheduledJob(job as ScheduledJob);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Scheduled job failed; inspect the persisted job log before retrying." }, { status: 500 });
  }
}