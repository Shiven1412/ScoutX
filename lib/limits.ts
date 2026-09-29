export const PLAN_LIMITS = {
  starter: { seats: 3, signals: 5_000, aiCredits: 5_000 },
  growth: { seats: 10, signals: 75_000, aiCredits: 25_000 },
  agency: { seats: 50, signals: 500_000, aiCredits: 100_000 },
} as const;

export type Plan = keyof typeof PLAN_LIMITS;
