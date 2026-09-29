import { NextResponse, type NextRequest } from "next/server";
import "server-only";
import { cookies } from "next/headers";
import { equalOAuthState } from "@/lib/security";
import { requireOrganization } from "@/lib/organization";
import { readJsonResponse } from "@/lib/http";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { encryptSecret } from "@/lib/secret-box";
import { deliverWebhookEvent } from "@/services/webhooks";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  if (provider !== "slack" && provider !== "hubspot") return NextResponse.json({ error: "Unsupported OAuth provider." }, { status: 404 });
  const returnUrl = new URL("/integrations", getPublicEnv().NEXT_PUBLIC_APP_URL);
  const cookieStore = await cookies();
  const stateCookie = `scoutify_oauth_${provider}`;
  const expectedState = cookieStore.get(stateCookie)?.value;
  cookieStore.delete(stateCookie);
  const receivedState = request.nextUrl.searchParams.get("state");
  if (!equalOAuthState(expectedState, receivedState)) {
    returnUrl.searchParams.set("error", "oauth_state");
    return NextResponse.redirect(returnUrl);
  }
  const providerError = request.nextUrl.searchParams.get("error");
  if (providerError) {
    returnUrl.searchParams.set("error", "oauth_denied");
    return NextResponse.redirect(returnUrl);
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    returnUrl.searchParams.set("error", "oauth_code");
    return NextResponse.redirect(returnUrl);
  }

  let supabase; let organization; let user;
  try {
    ({ supabase, organization, user } = await requireOrganization(["owner", "admin"]));
  } catch {
    return NextResponse.redirect(new URL("/login", getPublicEnv().NEXT_PUBLIC_APP_URL));
  }
  const env = getServerEnv();
  const clientId = provider === "slack" ? env.SLACK_CLIENT_ID : env.HUBSPOT_CLIENT_ID;
  const clientSecret = provider === "slack" ? env.SLACK_CLIENT_SECRET : env.HUBSPOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    returnUrl.searchParams.set("error", "oauth_config");
    return NextResponse.redirect(returnUrl);
  }
  const redirectUri = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`;
  let credentials: Record<string, unknown>;
  let displayConfig: Record<string, unknown>;
  try {
    if (provider === "slack") {
      const body = new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri });
      const response = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const result: unknown = await readJsonResponse(response, "Slack");
      if (!response.ok || !isRecord(result) || result.ok !== true || typeof result.access_token !== "string") throw new Error("Slack authorization could not be exchanged.");
      credentials = { access_token: result.access_token, refresh_token: typeof result.refresh_token === "string" ? result.refresh_token : null, expires_in: typeof result.expires_in === "number" ? result.expires_in : null };
      const team = isRecord(result.team) ? result.team : {};
      displayConfig = { team_id: team.id, team_name: team.name, scope: result.scope, credentials_encrypted: encryptSecret(JSON.stringify(credentials)) };
    } else {
      const body = new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, code });
      const response = await fetch("https://api.hubapi.com/oauth/v1/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      const result: unknown = await readJsonResponse(response, "HubSpot");
      if (!response.ok || !isRecord(result) || typeof result.access_token !== "string" || typeof result.refresh_token !== "string") throw new Error("HubSpot authorization could not be exchanged.");
      credentials = { access_token: result.access_token, refresh_token: result.refresh_token, expires_at: typeof result.expires_in === "number" ? Date.now() + result.expires_in * 1000 : undefined };
      displayConfig = { portal_id: result.hub_id, scopes: result.scopes, credentials_encrypted: encryptSecret(JSON.stringify(credentials)) };
    }
  } catch {
    returnUrl.searchParams.set("error", "oauth_exchange");
    return NextResponse.redirect(returnUrl);
  }

  const { error } = await supabase.from("integrations").upsert({ organization_id: organization.id, provider, connected: true, sync_status: "healthy", last_sync_at: new Date().toISOString(), configuration: JSON.parse(JSON.stringify(displayConfig)) as Json }, { onConflict: "organization_id,provider" });
  if (error) {
    returnUrl.searchParams.set("error", "oauth_store");
    return NextResponse.redirect(returnUrl);
  }
  await supabase.from("activity_logs").insert({ organization_id: organization.id, user_id: user.id, action: "integration.oauth_connected", entity_type: "integration", metadata: { provider } });
  await deliverWebhookEvent(organization.id, "integration.connected", { provider }).catch((error: unknown) => console.error("Integration webhook delivery failed", error));
  returnUrl.searchParams.set("connected", provider);
  return NextResponse.redirect(returnUrl);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
