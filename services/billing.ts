import "server-only";

import { createCheckoutUrl, createPortalUrl } from "@/services/stripe";
import { createRazorpaySubscriptionUrl, isRazorpayConfigured, updateRazorpaySubscriptionPlan, cancelRazorpaySubscription } from "@/services/razorpay";

export const BillingService = {
  async createSubscriptionUrl(plan: "starter" | "growth" | "agency") {
    return isRazorpayConfigured() ? createRazorpaySubscriptionUrl(plan) : createCheckoutUrl(plan);
  },
  async openPortal() {
    return createPortalUrl();
  },
  async changePlan(plan: "starter" | "growth" | "agency") {
    return updateRazorpaySubscriptionPlan(plan);
  },
  async cancelSubscription() {
    return cancelRazorpaySubscription(true);
  },
};