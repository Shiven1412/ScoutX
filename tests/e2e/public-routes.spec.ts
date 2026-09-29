import { expect, test } from "@playwright/test";

test("marketing page contains no demo metrics and links to authentication", async ({ page }) => {
  const response = await page.goto("/");
  await expect(page.getByRole("heading", { name: /turn buyer intent into real pipeline/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
  await expect(page.getByText(/3\.2M|284k|84\.2M|Maya Kim/)).toHaveCount(0);
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("https://us-assets.i.posthog.com");
});

test("login and registration are addressable routes", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByLabel("Work email")).toBeVisible();
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("protected routes redirect unauthenticated users to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
});
