"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicEnv, getServerEnv } from "@/lib/env";
import { requireOrganization } from "@/lib/organization";

export async function startProviderOAuth(form: FormData) {
  const provider = String(form.get("provider") ?? "");
  if (provider !== "slack" && provider !== "hubspot") return { error: "Unsupported OAuth provider." };
  await requireOrganization(["owner", "admin"]);
  const env = getServerEnv();
  const clientId = provider === "slack" ? env.SLACK_CLIENT_ID : env.HUBSPOT_CLIENT_ID;
  if (!clientId) return { error: `${provider === "slack" ? "Slack" : "HubSpot"} OAuth client ID is not configured.` };
  const state = randomBytes(32).toString("base64url");
  const cookieStore = await cookies();
  cookieStore.set(`scoutify_oauth_${provider}`, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: `/api/integrations/${provider}/callback`, maxAge: 600 });
  const redirectUri = `${getPublicEnv().NEXT_PUBLIC_APP_URL}/api/integrations/${provider}/callback`;
  const url = provider === "slack"
    ? new URL("https://slack.com/oauth/v2/authorize")
    : new URL("https://app.hubspot.com/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", provider === "slack" ? "chat:write,chat:write.public,channels:read" : "crm.objects.contacts.read crm.objects.contacts.write crm.objects.companies.read");
  redirect(url.toString());
}

