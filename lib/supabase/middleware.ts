import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { requireSupabasePublicEnv } from "@/lib/env";

const protectedPrefixes = ["/onboarding", "/dashboard", "/intents", "/outreach", "/campaigns", "/leads", "/analytics", "/integrations", "/billing", "/settings", "/admin"];
const userOnlyPrefixes = ["/settings/team/invitations"];
const authPrefixes = ["/login", "/register", "/forgot-password"];

export async function updateSession(request: NextRequest) {
  const nextResponse = () => NextResponse.next({ request: { headers: new Headers(request.headers) } });
  let response = nextResponse();
  const hasSupabaseConfig = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!hasSupabaseConfig) {
    if (protectedPrefixes.some((prefix) => request.nextUrl.pathname.startsWith(prefix))) {
      const target = new URL("/login", request.url);
      target.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
      return NextResponse.redirect(target);
    }
    return response;
  }

  const { url, anonKey } = requireSupabasePublicEnv();
  const supabase = createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isUserOnly = userOnlyPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isProtected = protectedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const isAuth = authPrefixes.some((prefix) => pathname === prefix);

  if (isProtected && !user) {
    const target = new URL("/login", request.url);
    target.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(target);
  }
  if (isUserOnly && !user) {
    const target = new URL("/login", request.url);
    target.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(target);
  }
  if ((isProtected || isUserOnly) && user && !user.email_confirmed_at) {
    return NextResponse.redirect(new URL("/login?notice=verify-email", request.url));
  }
  if (isAuth && user) return NextResponse.redirect(new URL("/dashboard", request.url));
  return response;
}
