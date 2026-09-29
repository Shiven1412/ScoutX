import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireUser: async () => ({
    supabase: { rpc: mocks.rpc },
    user: { id: "b3cb2fee-30f4-43c2-9a5b-2916aed7c12b" },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { createWorkspace } from "@/actions/onboarding";

describe("atomic workspace onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.rpc.mockResolvedValue({ data: "workspace-id", error: null });
    mocks.redirect.mockImplementation(() => { throw new Error("NEXT_REDIRECT"); });
  });

  it("creates the organization, trackers, profile, and activity in one RPC", async () => {
    await expect(createWorkspace({ name: "Acme Research", industry: "Technology", keywords: "buyer intent, buyer intent, churn" })).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("create_workspace", expect.objectContaining({
      target_name: "Acme Research",
      target_industry: "Technology",
      target_keywords: ["buyer intent", "churn"],
      target_slug: expect.stringMatching(/^acme-research-b3cb2fee-[a-f0-9-]{6}$/),
    }));
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("does not continue or redirect when the transaction fails", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await expect(createWorkspace({ name: "Acme Research", keywords: "buyers" })).resolves.toEqual({
      error: "Unable to complete workspace setup. Your workspace was not partially created; please try again or contact support.",
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});