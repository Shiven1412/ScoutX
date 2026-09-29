import { z } from "zod";

export const signInSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
});

export const signUpSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
  company: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(100).optional().or(z.literal("")),
});

export const organizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  industry: z.string().trim().max(100).optional().or(z.literal("")),
  keywords: z.string().max(1000).optional(),
  businessDescription: z.string().trim().max(3000).optional(),
});

export const emailSchema = z.object({ email: z.string().trim().email().max(254) });
export const passwordSchema = z.object({ password: z.string().min(12).max(128) });
