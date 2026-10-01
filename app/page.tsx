import MarketingHome from "@/components/marketing-home";
import { getPublicEnv } from "@/lib/env";

export default function HomePage() {
  const env = getPublicEnv();
  return <MarketingHome demoBookingUrl={env.NEXT_PUBLIC_DEMO_BOOKING_URL} />;
}
