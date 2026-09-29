import { NextRequest, type NextRequest as NextRequestType } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { getPublicEnv } from "@/lib/env";

export async function middleware(request: NextRequestType) {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...bytes));
  const env = getPublicEnv();
  const connectionOrigins = new Set(["'self'"]);
  if (env.NEXT_PUBLIC_SUPABASE_URL) {
    const supabaseUrl = new URL(env.NEXT_PUBLIC_SUPABASE_URL);
    connectionOrigins.add(supabaseUrl.origin);
    connectionOrigins.add(`wss://${supabaseUrl.host}`);
  }
  const posthogUrl = new URL(env.NEXT_PUBLIC_POSTHOG_HOST);
  connectionOrigins.add(posthogUrl.origin);
  const posthogRegion = /^(us|eu)\.i\.posthog\.com$/i.exec(posthogUrl.hostname)?.[1];
  if (posthogRegion) connectionOrigins.add(`https://${posthogRegion.toLowerCase()}-assets.i.posthog.com`);
  if (env.NEXT_PUBLIC_SENTRY_DSN) connectionOrigins.add(new URL(env.NEXT_PUBLIC_SENTRY_DSN).origin);
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src ${[...connectionOrigins].join(" ")}`,
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const requestWithNonce = new NextRequest(request, { headers: requestHeaders });
  const response = await updateSession(requestWithNonce);
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "on");
  if (process.env.NODE_ENV === "production") response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
