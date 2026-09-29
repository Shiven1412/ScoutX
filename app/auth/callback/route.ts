import { NextResponse, type NextRequest } from "next/server";
import { safeRedirectPath } from "@/lib/security";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const tokenType = request.nextUrl.searchParams.get("type");
  const next = safeRedirectPath(request.nextUrl.searchParams.get("next"), "/dashboard");
  if (!code && (!tokenHash || !["signup", "invite", "recovery", "email", "magiclink", "email_change"].includes(tokenType ?? ""))) return NextResponse.redirect(new URL("/login?error=verification", request.url));

  const supabase = await createClient();
  const { error } = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: tokenType as "signup" | "invite" | "recovery" | "email" | "magiclink" | "email_change" });
  if (error) return NextResponse.redirect(new URL("/login?error=verification", request.url));
  const { data: { user } } = await supabase.auth.getUser();
  const initialAdminEmail = getServerEnv().INITIAL_ADMIN_EMAIL?.toLowerCase();
  if (user?.email && initialAdminEmail && user.email.toLowerCase() === initialAdminEmail && user.email_confirmed_at) {
    const admin = createAdminClient();
    const { error: profileError } = await admin.from("profiles").upsert({ id: user.id, full_name: typeof user.user_metadata.full_name === "string" ? user.user_metadata.full_name : user.email.split("@")[0], company: typeof user.user_metadata.company === "string" ? user.user_metadata.company : null, industry: typeof user.user_metadata.industry === "string" ? user.user_metadata.industry : null, is_platform_admin: true }, { onConflict: "id" });
    if (profileError) return NextResponse.redirect(new URL("/login?error=admin-setup", request.url));
  }
  if (next === "/onboarding" && !user?.email_confirmed_at) return NextResponse.redirect(new URL("/login?notice=verify-email", request.url));
  return NextResponse.redirect(new URL(next, request.url));
}
