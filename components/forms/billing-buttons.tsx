"use client";

import { useState, useTransition } from "react";
import { cancelSubscription, changeSubscriptionPlan, openBillingPortal, startSubscription } from "@/actions/billing";
import { Button, type ButtonProps } from "@/components/ui/button";

export function BillingButton({ children, variant }: { children: React.ReactNode; variant?: ButtonProps["variant"] }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button type="button" variant={variant} disabled={pending} onClick={() => startTransition(async () => { setError(undefined); const result = await openBillingPortal(); if (result?.error) setError(result.error); })}>{pending ? "Opening…" : children}</Button>{error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}</div>;
}

export function PlanButton({ plan, current, subscribed, provider }: { plan: "starter" | "growth" | "agency"; current: boolean; subscribed: boolean; provider: "stripe" | "razorpay" | null }) {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div className="mt-5"><Button className="w-full" variant={current ? "secondary" : "primary"} disabled={pending || (subscribed && provider === "razorpay" && current)} onClick={() => startTransition(async () => {
    setError(undefined);
    const form = new FormData(); form.set("plan", plan);
    if (subscribed && provider === "stripe") { const result = await openBillingPortal(); if (result?.error) setError(result.error); return; }
    if (subscribed && provider === "razorpay") { const result = await changeSubscriptionPlan(form); if (result?.error) setError(result.error); return; }
    const result = await startSubscription(form);
    if (result?.error) setError(result.error);
  })}>{pending ? "Processing…" : subscribed && provider === "stripe" && current ? "Manage in Stripe" : subscribed && provider === "razorpay" ? current ? "Current plan" : `Change to ${plan}` : `Subscribe to ${plan}`}</Button>{error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}</div>;
}

export function CancelSubscriptionButton() {
  const [error, setError] = useState<string>(); const [pending, startTransition] = useTransition();
  return <div><Button type="button" variant="secondary" disabled={pending} onClick={() => startTransition(async () => { setError(undefined); const result = await cancelSubscription(); if (result?.error) setError(result.error); })}>{pending ? "Submitting…" : "Cancel at period end"}</Button>{error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}</div>;
}
