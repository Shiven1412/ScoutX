import type { Metadata } from "next";
import "./globals.css";
import { Suspense } from "react";
import { AnalyticsProvider } from "@/components/providers/analytics-provider";
import { getPublicEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: { default: "ScoutX — Intent intelligence for revenue teams", template: "%s · ScoutX" },
  description: "ScoutX — Find buyers before your competitors do.",
  openGraph: {
    title: "ScoutX — Find buyers before your competitors do.",
    description: "Turn real buyer conversations into qualified pipeline with ScoutX.",
    siteName: "ScoutX",
    type: "website",
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const env = getPublicEnv();
  return <html lang="en"><body><Suspense fallback={children}><AnalyticsProvider apiKey={env.NEXT_PUBLIC_POSTHOG_KEY} host={env.NEXT_PUBLIC_POSTHOG_HOST}>{children}</AnalyticsProvider></Suspense></body></html>;
}
