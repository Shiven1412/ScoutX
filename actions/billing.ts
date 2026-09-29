"use server";

import { redirect } from "next/navigation";
import { BillingService } from "@/services/billing";
import { requireOrganization } from "@/lib/organization";

export async function startSubscription(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  if (!["starter", "growth", "agency"].includes(plan)) return { error: "Select a valid plan." };
  try { redirect(await BillingService.createSubscriptionUrl(plan as "starter" | "growth" | "agency")); }
  catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    return { error: error instanceof Error ? error.message : "Checkout could not be started." };
  }
}

export async function openBillingPortal() {
  try { redirect(await BillingService.openPortal()); }
  catch (error) {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
    return { error: error instanceof Error ? error.message : "Billing portal could not be opened." };
  }
}

export async function changeSubscriptionPlan(form: FormData) {
  const plan = String(form.get("plan") ?? "");
  if (!["starter", "growth", "agency"].includes(plan)) return { error: "Select a valid plan." };
  try {
    await BillingService.changePlan(plan as "starter" | "growth" | "agency");
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The plan change could not be requested." };
  }
}

export async function cancelSubscription() {
  try {
    const { supabase, organization } = await requireOrganization(["owner", "admin"]);
    const { data: current, error } = await supabase.from("subscriptions").select("payment_provider").eq("organization_id", organization.id).maybeSingle();
    if (error) return { error: "Subscription state could not be loaded." };
    if (current?.payment_provider !== "razorpay") return { error: "Use the Stripe billing portal to cancel this subscription." };
    await BillingService.cancelSubscription();
    return { success: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The cancellation could not be requested." };
  }
}
