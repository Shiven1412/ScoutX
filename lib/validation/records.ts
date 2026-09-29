import { z } from "zod";

const csvItems = z.string().max(2000).transform((value) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 50));

export const trackerSchema = z.object({
  keyword: z.string().trim().min(2).max(180),
  negativeKeywords: csvItems,
  communities: csvItems,
  platforms: csvItems,
  alertThreshold: z.coerce.number().int().min(0).max(100),
});

export const leadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  company: z.string().trim().min(1).max(180),
  title: z.string().trim().max(160).optional(),
  email: z.union([z.string().trim().email().max(254), z.literal("")]).optional(),
  platform: z.string().trim().max(80).optional(),
  sourcePost: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(10000).optional(),
  status: z.enum(["new", "contacted", "replied", "meeting", "converted", "disqualified"]).default("new"),
  estimatedValue: z.union([z.coerce.number().min(0).max(1_000_000_000), z.literal("").transform(() => undefined)]).optional(),
});

export const outreachSchema = z.object({
  leadId: z.string().uuid().optional().or(z.literal("")),
  channel: z.enum(["email", "linkedin"]),
  subject: z.string().trim().min(2).max(300),
  content: z.string().trim().min(20).max(20000),
});
