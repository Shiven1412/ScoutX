"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { slugify } from "@/lib/security";
import { organizationSchema } from "@/lib/validation/auth";

export async function createWorkspace(input: unknown) {
  const parsed = organizationSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the workspace details." };
  const businessDescription = parsed.data.businessDescription?.trim() ?? "";
  const { supabase, user } = await requireUser();
  const baseSlug = slugify(parsed.data.name);
  if (!baseSlug) return { error: "Enter a workspace name containing letters or numbers." };

  const keywords = [...new Set((parsed.data.keywords ?? "").split(",").map((value) => value.trim()).filter((value) => value.length >= 2))].slice(0, 10);
  const slug = `${baseSlug}-${user.id.replaceAll("-", "").slice(0, 8)}-${randomUUID().slice(0, 6)}`;
  const { error } = await supabase.rpc("create_workspace", {
    target_name: parsed.data.name,
    target_industry: parsed.data.industry || null,
    target_slug: slug,
    target_keywords: keywords,
  });
  if (error) return { error: "Unable to complete workspace setup. Your workspace was not partially created; please try again or contact support." };
  revalidatePath("/dashboard");
  if (businessDescription.length >= 20) {
    const cookieStore = await cookies();
    cookieStore.set("scoutx_tracker_brief", businessDescription, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/campaigns/new", maxAge: 180 });
    redirect("/campaigns/new");
  }
  redirect("/dashboard");
}
