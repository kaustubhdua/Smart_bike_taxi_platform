import { expect, test } from "@playwright/test";

test("root entry presents separate passenger and driver portals", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /How would you like to move today/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Continue as passenger/ })).toHaveAttribute("href", "/passenger");
  await expect(page.getByRole("link", { name: /Continue as driver/ })).toHaveAttribute("href", "/driver");
});

test("passenger portal offers account sign-in before journey planning", async ({ page }) => {
  await page.goto("/passenger");
  await expect(page.getByRole("heading", { name: "Where to?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create passenger account" })).toBeVisible();
});

test("driver portal offers secure sign-in and driver application", async ({ page }) => {
  await page.goto("/driver");
  await expect(page.getByRole("heading", { name: "Driver sign in" })).toBeVisible();
  await page.getByRole("button", { name: "New driver application" }).click();
  await expect(page.getByRole("heading", { name: "Apply to drive" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create driver application" })).toBeVisible();
});
