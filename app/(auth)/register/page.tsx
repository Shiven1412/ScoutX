import type { Metadata } from "next";
import { RegistrationFlow } from "@/components/forms/registration-flow";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return <RegistrationFlow />;
}
