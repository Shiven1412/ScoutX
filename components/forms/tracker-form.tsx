"use client";

import { TrackerWizard } from "@/components/forms/tracker-wizard";

export function TrackerForm({ initialDescription = "" }: { initialDescription?: string }) {
  return <TrackerWizard initialDescription={initialDescription} />;
}
